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
  serverRole: 'deploy' | 'build';
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
      serverRole: rs.serverRole === 'build' ? 'build' : 'deploy',
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
    if (rs.serverRole === 'build') {
      throw new BadRequestException(
        'This service uses a build-only host as its deploy target. Choose a deploy server under Remote servers.',
      );
    }
    const extra = await this.dockerHostEnvForServer(rs);
    return { ...base, ...extra };
  }

  /**
   * Env for `docker build` over SSH: dedicated build host when set, otherwise deploy host.
   * Prefer {@link mergeDockerHostEnvForBuildIds} from the executor with DB-resolved FKs so RelationId hydration cannot drop `buildRemoteServerId`.
   */
  async mergeDockerHostEnvForBuild(
    service: Service,
    base: NodeJS.ProcessEnv,
  ): Promise<NodeJS.ProcessEnv> {
    return this.mergeDockerHostEnvForBuildIds(base, {
      buildRemoteServerId:
        service.buildRemoteServerId ?? service.buildRemoteServer?.id ?? null,
      remoteServerId: service.remoteServerId ?? service.remoteServer?.id ?? null,
    });
  }

  /** Same as {@link mergeDockerHostEnvForBuild} but uses FK columns read from `services` (reliable during deploy). */
  async mergeDockerHostEnvForBuildIds(
    base: NodeJS.ProcessEnv,
    ids: { buildRemoteServerId: number | null; remoteServerId: number | null },
  ): Promise<NodeJS.ProcessEnv> {
    const id = ids.buildRemoteServerId ?? ids.remoteServerId;
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

  /**
   * Deploy / stack / compose only: `remoteServerId` (not build host).
   * Prefer over {@link mergeDockerHostEnv} when `service` may not hydrate RelationId FKs.
   */
  async mergeDockerHostEnvForDeployIds(
    base: NodeJS.ProcessEnv,
    remoteServerId: number | null,
  ): Promise<NodeJS.ProcessEnv> {
    if (remoteServerId == null) {
      return base;
    }
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      return base;
    }
    if (rs.serverRole === 'build') {
      throw new BadRequestException(
        'This service uses a build-only host as its deploy target. Choose a deploy server under Remote servers.',
      );
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
      serverRole: dto.serverRole === 'build' ? 'build' : 'deploy',
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

    // @IsOptional() skips validators when a field is null; never call .trim() on null (TypeError → 500).
    if (dto.privateKey != null) {
      const pem = String(dto.privateKey).trim();
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

    const svcRepo = this.remoteServerRepository.manager.getRepository(Service);
    if (dto.serverRole === 'build' && existing.serverRole !== 'build') {
      const n = await svcRepo.count({ where: { remoteServer: { id } } });
      if (n > 0) {
        throw new BadRequestException(
          `Cannot mark as build server: ${n} service(s) still use this host as the deploy target. Unlink them first.`,
        );
      }
    }
    if (dto.serverRole === 'deploy' && existing.serverRole === 'build') {
      const n = await svcRepo.count({ where: { buildRemoteServer: { id } } });
      if (n > 0) {
        throw new BadRequestException(
          `Cannot mark as deploy server: ${n} service(s) still use this host as the build target. Clear the build host on those services first.`,
        );
      }
    }

    const merged = this.remoteServerRepository.merge(existing, {
      name: dto.name != null ? String(dto.name).trim() : existing.name,
      host: dto.host != null ? String(dto.host).trim() : existing.host,
      sshUser: dto.sshUser != null ? String(dto.sshUser).trim() : existing.sshUser,
      port: dto.port != null ? dto.port : existing.port,
      serverRole:
        dto.serverRole === 'build'
          ? 'build'
          : dto.serverRole === 'deploy'
            ? 'deploy'
            : existing.serverRole,
      extraSshOptions:
        dto.extraSshOptions === undefined
          ? existing.extraSshOptions
          : dto.extraSshOptions != null
            ? String(dto.extraSshOptions).trim() || null
            : null,
      privateKeyEncrypted: nextEnc,
      privateKeyPath: nextPath,
    });
    const saved = await this.remoteServerRepository.save(merged);
    return this.toSafe(saved);
  }

  async remove(id: number): Promise<void> {
    await this.findEntityOrFail(id);
    const repo = this.remoteServerRepository.manager.getRepository(Service);
    const nDeploy = await repo.count({ where: { remoteServer: { id } } });
    const nBuild = await repo.count({ where: { buildRemoteServer: { id } } });
    const n = nDeploy + nBuild;
    if (n > 0) {
      throw new BadRequestException(
        `Cannot delete: ${n} service(s) still reference this remote server (deploy and/or build). Unlink them first.`,
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

  /** All files under `rootAbs` as POSIX paths relative to the context root (for Dockerode `buildImage` + .dockerignore). */
  private async collectRelativeFilePathsForDockerBuild(rootAbs: string): Promise<string[]> {
    const root = path.resolve(rootAbs);
    const out: string[] = [];

    const walk = async (dirAbs: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(dirAbs, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
        } else if (ent.isFile()) {
          const rel = path.relative(root, full);
          out.push(rel.split(path.sep).join('/'));
        } else if (ent.isSymbolicLink()) {
          try {
            const st = await fs.stat(full);
            if (st.isFile()) {
              const rel = path.relative(root, full);
              out.push(rel.split(path.sep).join('/'));
            }
          } catch {
            /* skip broken symlinks */
          }
        }
      }
    };

    await walk(root);
    return out;
  }

  private followDockerProgressToString(
    docker: Dockerode,
    stream: NodeJS.ReadableStream,
  ): Promise<{ text: string; streamError: string | null }> {
    type DockerWithFollow = Dockerode & {
      followProgress: (
        s: NodeJS.ReadableStream,
        onFinished: (err: Error | null | undefined, output?: unknown[]) => void,
        onProgress?: (e: unknown) => void,
      ) => void;
    };
    return new Promise((resolve, reject) => {
      (docker as DockerWithFollow).followProgress(
        stream,
        (err: Error | null | undefined, output?: unknown[]) => {
          if (err) {
            reject(err);
            return;
          }
          const events = output ?? [];
          const textParts: string[] = [];
          let streamError: string | null = null;
          for (const ev of events) {
            if (!ev || typeof ev !== 'object') continue;
            const o = ev as Record<string, unknown>;
            if (typeof o.stream === 'string') textParts.push(o.stream);
            if (typeof o.status === 'string') textParts.push(`${o.status}\n`);
            if (typeof o.progress === 'string') textParts.push(`${o.progress}\n`);
            if (o.error != null) {
              streamError = String(o.error);
              if (
                o.errorDetail &&
                typeof o.errorDetail === 'object' &&
                o.errorDetail !== null &&
                'message' in o.errorDetail
              ) {
                streamError += `\n${String((o.errorDetail as { message: string }).message)}`;
              }
            }
          }
          resolve({ text: textParts.join(''), streamError });
        },
        undefined,
      );
    });
  }

  /**
   * Build on a remote host via Dockerode + ssh2 (same as console / testConnection), not `docker build` + DOCKER_HOST=ssh://…
   * (avoids OpenSSH/dial-stdio issues on some API hosts).
   */
  async buildImageUsingDockerodeSsh(
    remoteServerId: number,
    params: { contextPath: string; dockerfilePosix: string; tag: string },
  ): Promise<{ output: string }> {
    const rs = await this.findEntityOrFail(remoteServerId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const docker = this.createDockerodeForRemote(rs, pem);
    const ctx = path.resolve(params.contextPath);
    const src = await this.collectRelativeFilePathsForDockerBuild(ctx);
    if (src.length === 0) {
      throw new BadRequestException(`Build context has no files: ${ctx}`);
    }
    let stream: NodeJS.ReadableStream;
    try {
      stream = await docker.buildImage(
        { context: ctx, src },
        {
          t: params.tag,
          dockerfile: params.dockerfilePosix,
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Remote Docker build (host #${remoteServerId}) failed to start: ${msg}`,
      );
    }
    try {
      const { text, streamError } = await this.followDockerProgressToString(docker, stream);
      if (streamError) {
        throw new InternalServerErrorException(
          `Docker build failed on remote host #${remoteServerId}:\n${streamError}\n\n${text}`,
        );
      }
      return { output: text.trim() || '(build finished with no log output)' };
    } catch (e) {
      if (e instanceof InternalServerErrorException || e instanceof BadRequestException) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Docker build failed on remote host #${remoteServerId}: ${msg}`,
      );
    }
  }

  /** Push an image on a remote host via Dockerode (registry auth from caller). */
  async pushImageUsingDockerodeSsh(
    remoteServerId: number,
    params: {
      imageRef: string;
      auth: { username: string; password: string; serveraddress: string } | null;
    },
  ): Promise<{ output: string }> {
    const rs = await this.findEntityOrFail(remoteServerId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const docker = this.createDockerodeForRemote(rs, pem);
    const image = docker.getImage(params.imageRef);
    const opts: Record<string, unknown> = {};
    if (params.auth) {
      opts.authconfig = params.auth;
    }
    let stream: NodeJS.ReadableStream;
    try {
      stream = await image.push(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Remote Docker push (host #${remoteServerId}) failed to start: ${msg}`,
      );
    }
    try {
      const { text, streamError } = await this.followDockerProgressToString(docker, stream);
      if (streamError) {
        throw new InternalServerErrorException(
          `Docker registry push failed on remote host #${remoteServerId}:\n${streamError}\n\n${text}`,
        );
      }
      return { output: text.trim() || '(push finished with no log output)' };
    } catch (e) {
      if (e instanceof InternalServerErrorException || e instanceof BadRequestException) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Docker registry push failed on remote host #${remoteServerId}: ${msg}`,
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
