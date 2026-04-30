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
import * as net from 'net';
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

  /**
   * Parse `WWW-Authenticate: Bearer realm="...",service="...",scope="..."` from Docker Registry V2.
   */
  private parseDockerRegistryBearerChallenge(
    wwwAuthenticate: string | null,
  ): Record<string, string> | null {
    if (!wwwAuthenticate) return null;
    const t = wwwAuthenticate.trim();
    if (!t.toLowerCase().startsWith('bearer')) return null;
    const out: Record<string, string> = {};
    const re = /([a-zA-Z0-9_]+)="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      out[m[1].toLowerCase()] = m[2];
    }
    return out.realm ? out : null;
  }

  private buildDockerRegistryTokenUrl(
    challenge: Record<string, string>,
    username: string,
  ): string {
    const realm = challenge.realm;
    const u = new URL(realm);
    if (challenge.service) u.searchParams.set('service', challenge.service);
    if (challenge.scope) u.searchParams.set('scope', challenge.scope);
    const acc = username.trim();
    if (acc) u.searchParams.set('account', acc);
    return u.toString();
  }

  private isPrivateOrReservedIp(host: string): boolean {
    const version = net.isIP(host);
    if (version === 4) {
      const parts = host.split('.').map((n) => Number(n));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
      const [a, b] = parts;
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      return false;
    }
    if (version === 6) {
      const v = host.toLowerCase();
      if (v === '::1') return true;
      if (v.startsWith('fe80:')) return true; // link-local
      if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
      return false;
    }
    return false;
  }

  private assertPublicRegistryEndpoint(origin: string): void {
    let host = '';
    try {
      host = new URL(origin).hostname.trim().toLowerCase();
    } catch {
      throw new BadRequestException('Invalid registry provider URL.');
    }
    if (!host) {
      throw new BadRequestException('Invalid registry provider URL.');
    }
    if (host === 'localhost') {
      throw new BadRequestException('Registry provider host must be publicly reachable.');
    }
    if (this.isPrivateOrReservedIp(host)) {
      throw new BadRequestException('Registry provider host must not be loopback/private/link-local.');
    }
  }

  private async assertRegistryCredentialsValid(
    providerUrl: string,
    username: string,
    password: string,
  ): Promise<void> {
    const origin = this.registryV2Origin(providerUrl);
    this.assertPublicRegistryEndpoint(origin);
    const basicAuth = Buffer.from(`${username}:${password}`, 'utf8').toString(
      'base64',
    );
    const basicHeaders = { Authorization: `Basic ${basicAuth}` };

    const readBody = async (res: Response, max = 800): Promise<string> =>
      (await res.text()).trim().slice(0, max);

    const throwUnauthorized = async (res: Response, fallback: string) => {
      const t = await readBody(res);
      throw new UnauthorizedException(
        t || `${fallback} (${res.status}) for ${origin}`,
      );
    };

    // 1) Anonymous ping (Docker/GitLab/GHCR return 401 + Bearer challenge for /v2/)
    let res = await fetch(`${origin}/v2/`, { method: 'GET' });
    if (res.ok) {
      // Registry allows anonymous /v2/ — still verify supplied credentials.
      res = await fetch(`${origin}/v2/`, { method: 'GET', headers: basicHeaders });
      if (res.ok) return;
      await throwUnauthorized(res, 'Registry rejected credentials');
    }

    if (res.status === 401) {
      const challenge = this.parseDockerRegistryBearerChallenge(
        res.headers.get('www-authenticate'),
      );
      if (challenge?.realm) {
        const tokenUrl = this.buildDockerRegistryTokenUrl(challenge, username);
        const tokenRes = await fetch(tokenUrl, { headers: basicHeaders });
        if (tokenRes.ok) {
          const j = (await tokenRes.json()) as {
            token?: string;
            access_token?: string;
          };
          const bearer = (j.token ?? j.access_token)?.trim();
          if (bearer) {
            res = await fetch(`${origin}/v2/`, {
              method: 'GET',
              headers: { Authorization: `Bearer ${bearer}` },
            });
            if (res.ok) return;
          }
        } else if (tokenRes.status === 401 || tokenRes.status === 403) {
          await throwUnauthorized(
            tokenRes,
            'Registry rejected credentials at token endpoint',
          );
        }
      }
    }

    // 2) Legacy: Basic auth directly on /v2/
    res = await fetch(`${origin}/v2/`, { method: 'GET', headers: basicHeaders });
    if (res.ok) return;

    if (res.status === 401 || res.status === 403) {
      await throwUnauthorized(res, 'Registry rejected credentials');
    }
    await throwUnauthorized(res, 'Registry check failed');
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
    userId: number | null,
  ): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
    if (!userId || userId < 1) {
      return {
        env: base,
        cleanup: async () => {},
      };
    }
    const host = registryHostFromImageRef(imageRef);
    const normalized = normalizeProviderUrl(host);
    const account = await this.registryAccountRepository.findOne({
      where: { providerUrl: normalized, userId },
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
    userId: number | null,
  ): Promise<{
    username: string;
    password: string;
    serveraddress: string;
  } | null> {
    if (!userId || userId < 1) {
      return null;
    }
    const host = registryHostFromImageRef(imageRef);
    const normalized = normalizeProviderUrl(host);
    const account = await this.registryAccountRepository.findOne({
      where: { providerUrl: normalized, userId },
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
