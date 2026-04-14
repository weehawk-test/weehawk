import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { encryptPrivateKey, decryptPrivateKey } from '../remote-servers/ssh-key-crypto';
import { RegistryAccount } from './entities/registry-account.entity';
import type { CreateRegistryAccountDto } from './dto/create-registry-account.dto';
import {
  normalizeProviderUrl,
  registryHostFromImageRef,
} from './registry-host-from-image';

export type RegistryAccountSafe = {
  id: number;
  name: string;
  providerUrl: string;
  username: string;
  lastVerifiedAt: string | null;
};

@Injectable()
export class RegistryService {
  constructor(
    @InjectRepository(RegistryAccount)
    private readonly registryAccountRepository: Repository<RegistryAccount>,
    private readonly configService: ConfigService,
  ) {}

  private assertNonEmpty(value: string, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${label} is required`);
    }
    return trimmed;
  }

  private getEncryptionSecret(): string {
    const s = this.configService.get<string>('WEEHAWK_ENCRYPTION_KEY');
    if (!s || !String(s).trim()) {
      throw new BadRequestException(
        'WEEHAWK_ENCRYPTION_KEY is not set. It is required to store registry passwords in the database.',
      );
    }
    return String(s).trim();
  }

  /** Docker Registry HTTP V2 root (no local `docker` CLI on the API host). */
  private registryV2Origin(providerUrl: string): string {
    const p = normalizeProviderUrl(providerUrl);
    if (p === 'docker.io') {
      return 'https://registry-1.docker.io';
    }
    if (p.includes('://')) {
      return p.replace(/\/+$/, '');
    }
    return `https://${p}`;
  }

  private async assertRegistryCredentialsValid(
    providerUrl: string,
    username: string,
    password: string,
  ): Promise<void> {
    const origin = this.registryV2Origin(providerUrl);
    const auth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    const res = await fetch(`${origin}/v2/`, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.status === 401 || res.status === 403) {
      const t = (await res.text()).trim().slice(0, 500);
      throw new UnauthorizedException(
        t || `Registry rejected credentials (${res.status}) for ${origin}`,
      );
    }
    if (!res.ok) {
      const t = (await res.text()).trim().slice(0, 800);
      throw new UnauthorizedException(
        t || `Registry check failed (${res.status}) for ${origin}`,
      );
    }
  }

  toSafe(row: RegistryAccount): RegistryAccountSafe {
    return {
      id: row.id,
      name: row.name,
      providerUrl: row.providerUrl,
      username: row.username,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    };
  }

  async listAccounts(userId: number): Promise<RegistryAccountSafe[]> {
    const rows = await this.registryAccountRepository.find({
      where: { userId },
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.toSafe(r));
  }

  async createAccount(userId: number, dto: CreateRegistryAccountDto): Promise<RegistryAccountSafe> {
    const providerUrl = normalizeProviderUrl(dto.providerUrl);
    if (!providerUrl) {
      throw new BadRequestException('providerUrl is required');
    }
    const name = dto.name.trim();
    const username = dto.username.trim();
    const password = dto.password;

    try {
      await this.assertRegistryCredentialsValid(providerUrl, username, password);

      const enc = encryptPrivateKey(password, this.getEncryptionSecret());
      const existing = await this.registryAccountRepository.findOne({
        where: { userId, providerUrl },
      });
      if (existing) {
        existing.name = name;
        existing.username = username;
        existing.passwordEncrypted = enc;
        existing.lastVerifiedAt = new Date();
        const saved = await this.registryAccountRepository.save(existing);
        return this.toSafe(saved);
      }
      const created = this.registryAccountRepository.create({
        userId,
        name,
        providerUrl,
        username,
        passwordEncrypted: enc,
        lastVerifiedAt: new Date(),
      });
      const saved = await this.registryAccountRepository.save(created);
      return this.toSafe(saved);
    } catch (e) {
      if (
        e instanceof UnauthorizedException ||
        e instanceof BadRequestException ||
        e instanceof ForbiddenException
      ) {
        throw e;
      }
      const message = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(`Registry save failed: ${message}`);
    }
  }

  async removeAccount(userId: number, id: number): Promise<{ success: true }> {
    const row = await this.registryAccountRepository.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Registry account #${id} not found`);
    await this.registryAccountRepository.remove(row);
    return { success: true };
  }

  /**
   * Merge credentials from DB into env via isolated DOCKER_CONFIG (Dokploy-style: no reliance on host ~/.docker only).
   */
  async mergePushEnvForImageRef(
    imageRef: string,
    base: NodeJS.ProcessEnv,
  ): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
    const host = registryHostFromImageRef(imageRef);
    const normalized = normalizeProviderUrl(host);
    const account = await this.registryAccountRepository.findOne({
      where: { providerUrl: normalized },
    });
    if (!account) {
      return {
        env: base,
        cleanup: async () => {},
      };
    }

    let password: string;
    try {
      password = decryptPrivateKey(
        account.passwordEncrypted,
        this.getEncryptionSecret(),
      );
    } catch {
      return { env: base, cleanup: async () => {} };
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'weehawk-docker-push-'));
    const auth = Buffer.from(`${account.username}:${password}`, 'utf8').toString(
      'base64',
    );
    const auths: Record<string, { auth: string }> = {
      [account.providerUrl]: { auth },
    };
    if (account.providerUrl === 'docker.io') {
      auths['https://index.docker.io/v1/'] = { auth };
    }

    try {
      await fs.writeFile(
        path.join(tmp, 'config.json'),
        JSON.stringify({ auths }),
        'utf8',
      );
    } catch {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return { env: base, cleanup: async () => {} };
    }

    const env = { ...base, DOCKER_CONFIG: tmp };
    return {
      env,
      cleanup: async () => {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      },
    };
  }

  /**
   * Auth for Dockerode `Image.push` (Docker API / X-Registry-Auth), same credentials as mergePushEnvForImageRef.
   * Returns null when no account exists or decryption fails.
   */
  async getRegistryAuthConfigForImageRef(
    imageRef: string,
  ): Promise<{
    username: string;
    password: string;
    serveraddress: string;
  } | null> {
    const host = registryHostFromImageRef(imageRef);
    const normalized = normalizeProviderUrl(host);
    const account = await this.registryAccountRepository.findOne({
      where: { providerUrl: normalized },
    });
    if (!account) {
      return null;
    }
    let password: string;
    try {
      password = decryptPrivateKey(
        account.passwordEncrypted,
        this.getEncryptionSecret(),
      );
    } catch {
      return null;
    }
    const serveraddress =
      account.providerUrl === 'docker.io'
        ? 'https://index.docker.io/v1/'
        : `https://${account.providerUrl}`;
    return {
      username: account.username.trim(),
      password,
      serveraddress,
    };
  }

  /** Legacy: login writes host docker config (optional one-off). */
  async login(providerUrl: string, username: string, password: string) {
    const safeProviderUrl = normalizeProviderUrl(
      this.assertNonEmpty(providerUrl, 'providerUrl'),
    );
    const safeUsername = this.assertNonEmpty(username, 'username');
    const safePassword = this.assertNonEmpty(password, 'password');

    try {
      await this.assertRegistryCredentialsValid(
        safeProviderUrl,
        safeUsername,
        safePassword,
      );

      return {
        success: true,
        providerUrl: safeProviderUrl,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Registry login failed: ${message}`,
      );
    }
  }

  async logout(providerUrl: string) {
    const safeProviderUrl = normalizeProviderUrl(
      this.assertNonEmpty(providerUrl, 'providerUrl'),
    );
    return {
      success: true,
      providerUrl: safeProviderUrl,
      output: 'Credentials are not cached on the API host (remote-only mode).',
    };
  }

  async verifyConnection(providerUrl: string, username: string, password: string) {
    const safeProviderUrl = normalizeProviderUrl(
      this.assertNonEmpty(providerUrl, 'providerUrl'),
    );
    const safeUsername = this.assertNonEmpty(username, 'username');
    const safePassword = this.assertNonEmpty(password, 'password');

    try {
      await this.assertRegistryCredentialsValid(
        safeProviderUrl,
        safeUsername,
        safePassword,
      );
      return {
        success: true,
        message: 'Registry credentials are valid',
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Registry verify failed: ${message}`,
      );
    }
  }
}
