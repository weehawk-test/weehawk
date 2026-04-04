import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Dockerode from 'dockerode';
import { RemoteServer } from './entities/remote-server.entity';
import { CreateRemoteServerDto } from './dto/create-remote-server.dto';
import { UpdateRemoteServerDto } from './dto/update-remote-server.dto';
import { Service } from '../services/entities/service.entity';
import type {
  PaginatedContainersDto,
  PaginatedImagesDto,
  PaginatedNetworksDto,
  PaginatedServicesDto,
  PaginatedVolumesDto,
} from '../docker/dto/paginated-list.dto';
import {
  pagedRemoteContainers,
  pagedRemoteImages,
  pagedRemoteNetworks,
  pagedRemoteServices,
  pagedRemoteVolumes,
  remoteContainerLogs,
  remoteServiceLogs,
  removeRemoteContainer,
  removeRemoteImage,
  removeRemoteNetwork,
  removeRemoteService,
  removeRemoteVolume,
} from './remote-docker-console.helper';
import { decryptPrivateKey, encryptPrivateKey } from './ssh-key-crypto';
import { generateEd25519SshKeyPair } from './ssh-ed25519-generate';

export type RemoteServerSafe = {
  id: number;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  /** How SSH identity is provided (never exposes raw PEM or ciphertext). */
  authMode: 'stored' | 'file' | 'none';
  /** True when a key is configured (DB or file). */
  hasPrivateKey: boolean;
  privateKeyPath: string | null;
  extraSshOptions: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class RemoteServersService {
  constructor(
    @InjectRepository(RemoteServer)
    private readonly remoteServerRepository: Repository<RemoteServer>,
    private readonly configService: ConfigService,
  ) {}

  private getEncryptionSecret(): string {
    const s = this.configService.get<string>('WEEHAWK_ENCRYPTION_KEY');
    if (!s || !String(s).trim()) {
      throw new BadRequestException(
        'WEEHAWK_ENCRYPTION_KEY is not set in the API environment. It is required to store SSH keys in the database.',
      );
    }
    return String(s).trim();
  }

  toSafe(rs: RemoteServer): RemoteServerSafe {
    const hasEnc = !!(rs.privateKeyEncrypted && rs.privateKeyEncrypted.trim());
    const hasPath = !!(rs.privateKeyPath && rs.privateKeyPath.trim());
    const hasPrivateKey = hasEnc || hasPath;
    let authMode: 'stored' | 'file' | 'none' = 'none';
    if (hasEnc) {
      authMode = 'stored';
    } else if (hasPath) {
      authMode = 'file';
    }
    return {
      id: rs.id,
      name: rs.name,
      host: rs.host,
      port: rs.port,
      sshUser: rs.sshUser,
      authMode,
      hasPrivateKey,
      privateKeyPath: hasPath ? rs.privateKeyPath! : null,
      extraSshOptions: rs.extraSshOptions ?? null,
      createdAt: rs.createdAt,
      updatedAt: rs.updatedAt,
    };
  }

  /** PEM text for Dockerode / temp file (decrypts DB or reads file path). */
  private async resolvePrivateKeyPem(rs: RemoteServer): Promise<string> {
    if (rs.privateKeyEncrypted?.trim()) {
      try {
        return decryptPrivateKey(rs.privateKeyEncrypted, this.getEncryptionSecret());
      } catch {
        throw new BadRequestException(
          'Could not decrypt stored SSH key. Ensure WEEHAWK_ENCRYPTION_KEY matches the value used when the key was saved.',
        );
      }
    }
    const p = (rs.privateKeyPath || '').trim();
    if (p) {
      await this.assertPrivateKeyPath(p);
      return await fs.readFile(p, 'utf8');
    }
    throw new BadRequestException(
      'Remote server has no SSH private key configured.',
    );
  }

  /**
   * Resolves identity to a filesystem path for `ssh -i` (decrypts DB key to a temp file when needed).
   */
  private async resolveIdentityFilePath(rs: RemoteServer): Promise<string> {
    if (rs.privateKeyEncrypted?.trim()) {
      const pem = await this.resolvePrivateKeyPem(rs);
      const dir = path.join(os.tmpdir(), 'weehawk-ssh-keys');
      await fs.mkdir(dir, { recursive: true });
      const fp = path.join(dir, `server-${rs.id}.key`);
      await fs.writeFile(fp, pem, { encoding: 'utf8', mode: 0o600 });
      await fs.chmod(fp, 0o600);
      return fp;
    }
    const p = (rs.privateKeyPath || '').trim();
    if (p) {
      await this.assertPrivateKeyPath(p);
      return p;
    }
    throw new BadRequestException(
      'Remote server has no SSH private key configured.',
    );
  }

  /**
   * Dockerode-over-SSH (ssh2), same approach as Dokploy — avoids spawning `docker` + system `ssh`
   * so Windows hosts are not blocked by DOCKER_SSH_OPTS / interactive host-key prompts.
   */
  private createDockerodeForRemote(rs: RemoteServer, privateKeyPem: string): Dockerode {
    const raw = rs.host.trim();
    const lower = raw.toLowerCase();
    const isLoopback =
      lower === 'localhost' ||
      raw === '127.0.0.1' ||
      lower === '::1' ||
      lower === '[::1]';
    const host = isLoopback ? 'localhost' : raw;
    const port = rs.port ?? 22;
    return new Dockerode({
      host,
      port,
      username: rs.sshUser.trim(),
      protocol: 'ssh',
      sshOptions: {
        privateKey: Buffer.from(privateKeyPem, 'utf8'),
        readyTimeout: 60_000,
        // Match non-interactive “first connect” UX; deploy still uses Docker CLI + OpenSSH.
        hostVerifier: () => true,
        ...(isLoopback ? { family: 4 } : {}),
      },
    });
  }

  /**
   * Docker CLI uses DOCKER_HOST=ssh://user@host[:port] and DOCKER_SSH_OPTS for identity / options.
   */
  async dockerHostEnvForServer(rs: RemoteServer): Promise<Record<string, string>> {
    const identityPath = await this.resolveIdentityFilePath(rs);
    const raw = rs.host.trim();
    const lower = raw.toLowerCase();
    const isLoopback =
      lower === 'localhost' ||
      raw === '127.0.0.1' ||
      lower === '::1' ||
      lower === '[::1]';
    // Use `localhost` in ssh:// so OpenSSH matches [localhost]:port in known_hosts (avoids yes/no prompts).
    // With `-4`, resolution stays on 127.0.0.1 so we don't hit ::1 when sshd listens on IPv4 only (common on Windows).
    const host = isLoopback ? 'localhost' : raw;
    const userHost =
      rs.port === 22 ? `${rs.sshUser}@${host}` : `${rs.sshUser}@${host}:${rs.port}`;
    const parts = [
      `-i "${identityPath.replace(/"/g, '\\"')}"`,
      ...(isLoopback ? (['-4'] as const) : []),
      '-o BatchMode=yes',
      '-o StrictHostKeyChecking=accept-new',
      '-o NoHostAuthenticationForLocalhost=yes',
    ];
    const extra = (rs.extraSshOptions || '').trim();
    if (extra) {
      parts.push(extra);
    }
    return {
      DOCKER_HOST: `ssh://${userHost}`,
      DOCKER_SSH_OPTS: parts.join(' '),
    };
  }

  /**
   * Merges Docker-over-SSH env when the service targets a remote server.
   */
  async mergeDockerHostEnv(
    service: Service,
    base: NodeJS.ProcessEnv,
  ): Promise<NodeJS.ProcessEnv> {
    const id = service.remoteServerId ?? service.remoteServer?.id;
    if (id == null) {
      return base;
    }
    const rs = await this.remoteServerRepository.findOne({ where: { id } });
    if (!rs) {
      return base;
    }
    const extra = await this.dockerHostEnvForServer(rs);
    return { ...base, ...extra };
  }

  async findAll(): Promise<RemoteServerSafe[]> {
    const rows = await this.remoteServerRepository.find({ order: { name: 'ASC' } });
    return rows.map((r) => this.toSafe(r));
  }

  async findOne(id: number): Promise<RemoteServerSafe> {
    const rs = await this.findEntityOrFail(id);
    return this.toSafe(rs);
  }

  private async findEntityOrFail(id: number): Promise<RemoteServer> {
    const rs = await this.remoteServerRepository.findOne({ where: { id } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${id} not found`);
    }
    return rs;
  }

  async create(dto: CreateRemoteServerDto): Promise<RemoteServerSafe> {
    const pem = dto.privateKey.trim();
    const privateKeyEncrypted = encryptPrivateKey(pem, this.getEncryptionSecret());

    const entity = this.remoteServerRepository.create({
      name: dto.name.trim(),
      host: dto.host.trim(),
      port: dto.port ?? 22,
      sshUser: dto.sshUser.trim(),
      privateKeyEncrypted,
      privateKeyPath: null,
      extraSshOptions: dto.extraSshOptions?.trim() || null,
    });
    const saved = await this.remoteServerRepository.save(entity);
    return this.toSafe(saved);
  }

  async update(id: number, dto: UpdateRemoteServerDto): Promise<RemoteServerSafe> {
    const existing = await this.findEntityOrFail(id);
    let privateKeyEncrypted: string | null | undefined = existing.privateKeyEncrypted;
    let privateKeyPath: string | null | undefined = existing.privateKeyPath;

    if (dto.privateKey !== undefined) {
      const pem = dto.privateKey.trim();
      if (pem.length > 0) {
        privateKeyEncrypted = encryptPrivateKey(pem, this.getEncryptionSecret());
        privateKeyPath = null;
      }
    }

    const nextEnc = privateKeyEncrypted ?? null;
    const nextPath = privateKeyPath != null ? String(privateKeyPath).trim() || null : null;
    if (!nextEnc?.trim() && !nextPath) {
      throw new BadRequestException(
        'An SSH private key is required. Paste a new privateKey (PEM) to replace it, or leave key fields unset to keep the current key.',
      );
    }

    const merged = this.remoteServerRepository.merge(existing, {
      name: dto.name !== undefined ? dto.name.trim() : existing.name,
      host: dto.host !== undefined ? dto.host.trim() : existing.host,
      sshUser: dto.sshUser !== undefined ? dto.sshUser.trim() : existing.sshUser,
      port: dto.port !== undefined ? dto.port : existing.port,
      extraSshOptions:
        dto.extraSshOptions === undefined
          ? existing.extraSshOptions
          : dto.extraSshOptions?.trim() || null,
      privateKeyEncrypted: nextEnc,
      privateKeyPath: nextPath,
    });
    const saved = await this.remoteServerRepository.save(merged);
    return this.toSafe(saved);
  }

  async remove(id: number): Promise<void> {
    await this.findEntityOrFail(id);
    const n = await this.remoteServerRepository.manager
      .getRepository(Service)
      .createQueryBuilder('s')
      .where('s.remoteServerId = :id', { id })
      .getCount();
    if (n > 0) {
      throw new BadRequestException(
        `Cannot delete: ${n} service(s) still use this remote server. Unlink them first.`,
      );
    }
    await this.remoteServerRepository.delete(id);
  }

  private async withRemoteDocker<T>(
    id: number,
    fn: (docker: Dockerode) => Promise<T>,
  ): Promise<T> {
    const rs = await this.findEntityOrFail(id);
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const docker = this.createDockerodeForRemote(rs, pem);
      return await fn(docker);
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Remote Docker console (host #${id}): ${msg}`,
      );
    }
  }

  async remoteConsoleContainersPaged(
    id: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedContainersDto> {
    return this.withRemoteDocker(id, (docker) =>
      pagedRemoteContainers(docker, page, pageSize, q),
    );
  }

  async remoteConsoleImagesPaged(
    id: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedImagesDto> {
    return this.withRemoteDocker(id, (docker) =>
      pagedRemoteImages(docker, page, pageSize, q),
    );
  }

  async remoteConsoleNetworksPaged(
    id: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedNetworksDto> {
    return this.withRemoteDocker(id, (docker) =>
      pagedRemoteNetworks(docker, page, pageSize, q),
    );
  }

  async remoteConsoleVolumesPaged(
    id: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedVolumesDto> {
    return this.withRemoteDocker(id, (docker) =>
      pagedRemoteVolumes(docker, page, pageSize, q),
    );
  }

  async remoteConsoleServicesPaged(
    id: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedServicesDto> {
    return this.withRemoteDocker(id, (docker) =>
      pagedRemoteServices(docker, page, pageSize, q),
    );
  }

  async remoteConsoleContainerLogs(
    id: number,
    containerId: string,
    tail: number,
  ): Promise<{ logs: string }> {
    const logs = await this.withRemoteDocker(id, (docker) =>
      remoteContainerLogs(docker, decodeURIComponent(containerId), tail),
    );
    return { logs };
  }

  async remoteConsoleServiceLogs(
    id: number,
    serviceId: string,
    tail: number,
  ): Promise<{ logs: string }> {
    const logs = await this.withRemoteDocker(id, (docker) =>
      remoteServiceLogs(docker, decodeURIComponent(serviceId), tail),
    );
    return { logs };
  }

  async remoteConsoleRemoveContainer(
    id: number,
    containerId: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, (docker) =>
      removeRemoteContainer(docker, decodeURIComponent(containerId), force),
    );
    return { success: true };
  }

  async remoteConsoleRemoveImage(id: number, ref: string): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, (docker) =>
      removeRemoteImage(docker, decodeURIComponent(ref)),
    );
    return { success: true };
  }

  async remoteConsoleRemoveVolume(
    id: number,
    name: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, (docker) =>
      removeRemoteVolume(docker, decodeURIComponent(name), force),
    );
    return { success: true };
  }

  async remoteConsoleRemoveNetwork(
    id: number,
    networkId: string,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, (docker) =>
      removeRemoteNetwork(docker, decodeURIComponent(networkId)),
    );
    return { success: true };
  }

  async remoteConsoleRemoveService(
    id: number,
    serviceId: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, (docker) =>
      removeRemoteService(docker, decodeURIComponent(serviceId), force),
    );
    return { success: true };
  }

  /** Validates SSH + remote Docker via Dockerode (GET /version over `docker system dial-stdio`). */
  async testConnection(id: number): Promise<{ success: boolean; output: string }> {
    const rs = await this.findEntityOrFail(id);
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const docker = this.createDockerodeForRemote(rs, pem);
      const v = await docker.version();
      const lines = [
        `Version: ${v.Version}`,
        `ApiVersion: ${v.ApiVersion}`,
        `Os: ${v.Os}`,
        `Arch: ${v.Arch}`,
        v.KernelVersion ? `KernelVersion: ${v.KernelVersion}` : '',
      ].filter((s) => s.length > 0);
      return { success: true, output: lines.join('\n') };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  /**
   * Ed25519 key pair via Node.js `crypto` — OpenSSH `openssh-key-v1` PEM + `.pub` style line (same as ssh-keygen).
   */
  generateSshKeyPair(): { privateKey: string; publicKey: string } {
    try {
      return generateEd25519SshKeyPair();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(`Could not generate SSH keys: ${msg}`);
    }
  }

  private async assertPrivateKeyPath(p: string): Promise<void> {
    const t = (p || '').trim();
    if (!t.startsWith('/') && !/^[A-Za-z]:\\/.test(t)) {
      throw new BadRequestException(
        'privateKeyPath must be an absolute path on the Weehawk API host.',
      );
    }
    try {
      await fs.access(t);
    } catch {
      throw new BadRequestException(
        `SSH private key file not found or not readable: ${t}`,
      );
    }
  }
}
