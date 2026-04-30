import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
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
import * as http from 'http';
import * as https from 'https';
import { promises as dns } from 'dns';
import {
  encryptPrivateKey,
  decryptPrivateKey,
} from '../remote-servers/ssh-key-crypto';
import { RegistryAccount } from './entities/registry-account.entity';
import type { CreateRegistryAccountDto } from './dto/create-registry-account.dto';
import {
  normalizeProviderUrl,
  registryHostFromImageRef,
} from './registry-host-from-image';
import { isRemoteSshIpBlocked } from '../remote-servers/remote-ssh-host-policy';
import { UserIdTenantScopedRepository } from '../common/tenant-scoped.service';

export type RegistryAccountSafe = {
  id: number;
  name: string;
  providerUrl: string;
  username: string;
  lastVerifiedAt: string | null;
};

@Injectable()
export class RegistryService {
  private readonly logger = new Logger(RegistryService.name);
  private readonly scopedRegistryAccounts: UserIdTenantScopedRepository<RegistryAccount>;

  constructor(
    @InjectRepository(RegistryAccount)
    private readonly registryAccountRepository: Repository<RegistryAccount>,
    private readonly configService: ConfigService,
  ) {
    this.scopedRegistryAccounts = new UserIdTenantScopedRepository<RegistryAccount>(
      this.registryAccountRepository,
      'Registry account',
    );
  }

  private static readonly REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

  private static readonly MAX_REDIRECTS = 5;

  private static readonly EMPTY_BODY_STATUSES = new Set([204, 205, 304]);

  private static readonly SAFE_REDIRECT_STATUSES = new Set([307, 308]);

  private static readonly NO_BODY_METHODS = new Set(['GET', 'HEAD']);

  private static readonly SENSITIVE_FORWARD_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'private-token',
    'x-auth-token',
    'cookie',
  ]);

  private static readonly JSON_HEADERS = {
    'content-type': 'application/json',
  };

  private normalizeHeaders(
    headers?: Record<string, string>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
      out[String(k).toLowerCase()] = String(v);
    }
    return out;
  }

  private stripSensitiveForwardHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const next = { ...headers };
    for (const name of RegistryService.SENSITIVE_FORWARD_HEADERS) {
      delete next[name];
    }
    return next;
  }

  private async requestWithPinnedIp(
    urlRaw: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      redirectLimit?: number;
    },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const limit = Math.max(0, options?.redirectLimit ?? RegistryService.MAX_REDIRECTS);
    let currentUrl = urlRaw;
    let method = String(options?.method ?? 'GET').toUpperCase();
    let body = options?.body;
    let headers = this.normalizeHeaders(options?.headers);
    let originalOrigin: string | null = null;

    for (let i = 0; i <= limit; i += 1) {
      const endpoint = await this.assertPublicRegistryEndpoint(currentUrl);
      if (!originalOrigin) {
        originalOrigin = new URL(endpoint.url).origin;
      }
      const res = await this.singlePinnedRequest(endpoint, {
        method,
        headers,
        body,
      });
      if (!RegistryService.REDIRECT_CODES.has(res.status)) {
        return res;
      }
      const location = res.headers['location']?.trim();
      if (!location) return res;
      if (i === limit) {
        throw new BadRequestException('Too many redirects while contacting registry.');
      }
      const redirectedUrl = new URL(location, endpoint.url);
      currentUrl = redirectedUrl.toString();
      const redirectedOrigin = redirectedUrl.origin;
      const crossOriginRedirect =
        originalOrigin != null && redirectedOrigin !== originalOrigin;
      if (crossOriginRedirect) {
        headers = this.stripSensitiveForwardHeaders(headers);
        if (!RegistryService.NO_BODY_METHODS.has(method)) {
          method = 'GET';
          body = undefined;
          delete headers['content-type'];
          delete headers['content-length'];
        }
      }
      if (
        !RegistryService.SAFE_REDIRECT_STATUSES.has(res.status) &&
        method === 'POST'
      ) {
        method = 'GET';
        body = undefined;
        delete headers['content-type'];
        delete headers['content-length'];
      }
    }
    throw new BadRequestException('Redirect handling failed unexpectedly.');
  }

  private async singlePinnedRequest(
    endpoint: { url: string; hostname: string; ipAddress: string },
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const u = new URL(endpoint.url);
    const isHttps = u.protocol === 'https:';
    const requestFn = isHttps ? https.request : http.request;
    const pinnedAddress = String(endpoint.ipAddress ?? '').trim();
    const pinnedFamily = net.isIP(pinnedAddress);
    if (pinnedFamily === 0) {
      throw new BadRequestException(
        'Registry provider host resolved to an invalid IP address.',
      );
    }
    const hasBody =
      options.body != null &&
      !RegistryService.NO_BODY_METHODS.has(options.method.toUpperCase());
    const headers = { ...options.headers, host: endpoint.hostname };
    if (hasBody && headers['content-length'] == null) {
      headers['content-length'] = String(Buffer.byteLength(options.body!, 'utf8'));
    }
    return await new Promise((resolve, reject) => {
      const req = requestFn(
        {
          protocol: u.protocol,
          hostname: pinnedAddress,
          port: u.port ? Number(u.port) : undefined,
          method: options.method,
          path: `${u.pathname}${u.search}`,
          headers,
          ...(isHttps ? { servername: endpoint.hostname } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const hdrs: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (v == null) continue;
              hdrs[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
            }
            const allowBody = !RegistryService.EMPTY_BODY_STATUSES.has(
              res.statusCode ?? 0,
            );
            resolve({
              status: res.statusCode ?? 0,
              headers: hdrs,
              body: allowBody ? Buffer.concat(chunks).toString('utf8') : '',
            });
          });
        },
      );
      req.on('error', reject);
      if (hasBody) req.write(options.body!);
      req.end();
    });
  }

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
    registryHost: string,
    username: string,
  ): string {
    const realm = challenge.realm;
    let u: URL;
    try {
      u = new URL(realm);
    } catch {
      throw new BadRequestException('Registry token endpoint is invalid.');
    }
    if (u.protocol !== 'https:') {
      throw new BadRequestException('Registry token endpoint must use HTTPS.');
    }
    const realmHost = u.hostname.trim().toLowerCase();
    if (!this.isAllowedTokenRealmHost(registryHost, realmHost)) {
      throw new BadRequestException(
        'Registry token endpoint host is not allowed for this provider.',
      );
    }
    if (challenge.service) u.searchParams.set('service', challenge.service);
    if (challenge.scope) u.searchParams.set('scope', challenge.scope);
    const acc = username.trim();
    if (acc) u.searchParams.set('account', acc);
    return u.toString();
  }

  private isAllowedTokenRealmHost(
    registryHost: string,
    realmHost: string,
  ): boolean {
    const r = registryHost.trim().toLowerCase();
    const t = realmHost.trim().toLowerCase();
    if (!r || !t) return false;
    if (r === t) return true;
    if (t.endsWith(`.${r}`)) return true;
    // Docker Hub uses registry-1.docker.io for /v2/ and auth.docker.io for token minting.
    if (r === 'registry-1.docker.io' && t === 'auth.docker.io') return true;
    // GitLab registry uses registry.gitlab.com for /v2/ and gitlab.com for token minting.
    if (r === 'registry.gitlab.com' && t === 'gitlab.com') return true;
    return false;
  }

  private isPrivateOrReservedIp(host: string): boolean {
    const version = net.isIP(host);
    if (version === 4) {
      const parts = host.split('.').map((n) => Number(n));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)))
        return true;
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

  private async assertPublicRegistryEndpoint(
    origin: string,
  ): Promise<{ url: string; hostname: string; ipAddress: string }> {
    let host = '';
    let parsed: URL;
    try {
      parsed = new URL(origin);
      host = parsed.hostname.trim().toLowerCase();
    } catch {
      throw new BadRequestException('Invalid registry provider URL.');
    }
    if (!host) {
      throw new BadRequestException('Invalid registry provider URL.');
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Registry provider URL must use HTTPS.');
    }
    if (host === 'localhost') {
      throw new BadRequestException(
        'Registry provider host must be publicly reachable.',
      );
    }
    if (this.isPrivateOrReservedIp(host)) {
      throw new BadRequestException(
        'Registry provider host must not be loopback/private/link-local.',
      );
    }
    if (net.isIP(host) !== 0) {
      if (isRemoteSshIpBlocked(host)) {
        throw new BadRequestException(
          'Registry provider host must not be loopback/private/link-local.',
        );
      }
      return {
        url: parsed.toString(),
        hostname: host,
        ipAddress: host,
      };
    }
    const v4 = await dns.resolve4(host).catch(() => [] as string[]);
    const v6 = await dns.resolve6(host).catch(() => [] as string[]);
    let ips = [...new Set([...v4, ...v6])];
    if (ips.length === 0) {
      // Fallback for environments where authoritative resolvers fail but the OS resolver works.
      const lookedUp = await dns
        .lookup(host, { all: true, verbatim: true })
        .catch(() => [] as { address: string; family: number }[]);
      ips = [...new Set(lookedUp.map((entry) => String(entry?.address ?? '').trim()))]
        .filter((entry) => entry.length > 0)
        .filter((entry) => net.isIP(entry) !== 0);
    }
    if (ips.length === 0) {
      throw new BadRequestException(
        'Registry provider host could not be resolved.',
      );
    }
    if (ips.length > 32) {
      throw new BadRequestException(
        'Registry provider host resolves to too many addresses.',
      );
    }
    for (const ip of ips) {
      if (isRemoteSshIpBlocked(ip)) {
        throw new BadRequestException(
          'Registry provider host must resolve only to public addresses.',
        );
      }
    }
    const selectedIp = ips.find((ip) => net.isIP(ip) !== 0);
    if (!selectedIp) {
      throw new BadRequestException(
        'Registry provider host could not be resolved to a valid IP.',
      );
    }
    return {
      url: parsed.toString(),
      hostname: host,
      ipAddress: selectedIp,
    };
  }

  private async assertRegistryCredentialsValid(
    providerUrl: string,
    username: string,
    password: string,
  ): Promise<void> {
    const origin = this.registryV2Origin(providerUrl);
    const registryEndpoint = await this.assertPublicRegistryEndpoint(origin);
    const registryHost = registryEndpoint.hostname;
    const basicAuth = Buffer.from(`${username}:${password}`, 'utf8').toString(
      'base64',
    );
    const basicHeaders = { Authorization: `Basic ${basicAuth}` };

    const readBody = (
      res: { body: string },
      max = 800,
    ): string => (res.body ?? '').trim().slice(0, max);

    const throwUnauthorized = async (
      res: { body: string; status: number },
      fallback: string,
    ) => {
      const t = readBody(res);
      throw new UnauthorizedException(
        t || `${fallback} (${res.status}) for ${origin}`,
      );
    };

    // 1) Anonymous ping (Docker/GitLab/GHCR return 401 + Bearer challenge for /v2/)
    let res = await this.requestWithPinnedIp(`${origin}/v2/`, { method: 'GET' });
    if (res.status >= 200 && res.status < 300) {
      // Registry allows anonymous /v2/ — still verify supplied credentials.
      res = await this.requestWithPinnedIp(`${origin}/v2/`, {
        method: 'GET',
        headers: basicHeaders,
      });
      if (res.status >= 200 && res.status < 300) return;
      await throwUnauthorized(res, 'Registry rejected credentials');
    }

    if (res.status === 401) {
      const challenge = this.parseDockerRegistryBearerChallenge(
        res.headers['www-authenticate'] ?? null,
      );
      if (challenge?.realm) {
        const tokenUrl = this.buildDockerRegistryTokenUrl(
          challenge,
          registryHost,
          username,
        );
        await this.assertPublicRegistryEndpoint(tokenUrl);
        const tokenRes = await this.requestWithPinnedIp(tokenUrl, {
          headers: basicHeaders,
        });
        if (tokenRes.status >= 200 && tokenRes.status < 300) {
          const j = JSON.parse(tokenRes.body) as {
            token?: string;
            access_token?: string;
          };
          const bearer = (j.token ?? j.access_token)?.trim();
          if (bearer) {
            res = await this.requestWithPinnedIp(`${origin}/v2/`, {
              method: 'GET',
              headers: { Authorization: `Bearer ${bearer}` },
            });
            if (res.status >= 200 && res.status < 300) return;
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
    res = await this.requestWithPinnedIp(`${origin}/v2/`, {
      method: 'GET',
      headers: basicHeaders,
    });
    if (res.status >= 200 && res.status < 300) return;

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
    const rows = await this.scopedRegistryAccounts.listScoped(userId, {
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.toSafe(r));
  }

  async createAccount(
    userId: number,
    dto: CreateRegistryAccountDto,
  ): Promise<RegistryAccountSafe> {
    const providerUrl = normalizeProviderUrl(dto.providerUrl);
    if (!providerUrl) {
      throw new BadRequestException('providerUrl is required');
    }
    const name = dto.name.trim();
    const username = dto.username.trim();
    const password = dto.password;

    try {
      await this.assertRegistryCredentialsValid(
        providerUrl,
        username,
        password,
      );

      const enc = encryptPrivateKey(password, this.getEncryptionSecret());
      let existing: RegistryAccount | null = null;
      try {
        existing = await this.scopedRegistryAccounts.findScopedBy(
          'providerUrl',
          providerUrl,
          userId,
        );
      } catch {
        existing = null;
      }
      if (existing) {
        existing.name = name;
        existing.username = username;
        existing.passwordEncrypted = enc;
        existing.lastVerifiedAt = new Date();
        const saved = await this.scopedRegistryAccounts.saveScoped(
          existing,
          userId,
        );
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
      const saved = await this.scopedRegistryAccounts.saveScoped(created, userId);
      return this.toSafe(saved);
    } catch (e) {
      if (
        e instanceof UnauthorizedException ||
        e instanceof BadRequestException ||
        e instanceof ForbiddenException
      ) {
        throw e;
      }
      this.logger.error(
        `Registry account upsert failed for provider "${providerUrl}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException('Registry operation failed');
    }
  }

  async removeAccount(userId: number, id: number): Promise<{ success: true }> {
    await this.scopedRegistryAccounts.deleteScoped(id, userId);
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
    let account: RegistryAccount | null = null;
    try {
      account = await this.scopedRegistryAccounts.findScopedBy(
        'providerUrl',
        normalized,
        userId,
      );
    } catch {
      account = null;
    }
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

    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'weehawk-docker-push-'),
    );
    const auth = Buffer.from(
      `${account.username}:${password}`,
      'utf8',
    ).toString('base64');
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
    let account: RegistryAccount | null = null;
    try {
      account = await this.scopedRegistryAccounts.findScopedBy(
        'providerUrl',
        normalized,
        userId,
      );
    } catch {
      account = null;
    }
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
      this.logger.error(
        `Registry login failed for provider "${safeProviderUrl}"`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Registry operation failed');
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

  async verifyConnection(
    providerUrl: string,
    username: string,
    password: string,
  ) {
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
      this.logger.error(
        `Registry verify failed for provider "${safeProviderUrl}"`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Registry operation failed');
    }
  }
}
