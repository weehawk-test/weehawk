import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createSign } from 'crypto';
import * as path from 'path';
import { Repository } from 'typeorm';
import { GitIntegrationSettings } from './entities/git-integration.entity';
import { UpdateGitSettingsDto } from './dto/update-git-settings.dto';
import { decryptPrivateKey, encryptPrivateKey } from '../remote-servers/ssh-key-crypto';
import type { Request } from 'express';

export type WeehawkRemoteGitMarkerV1 = {
  v: 1;
  provider: 'gitlab' | 'github';
  ref: string;
  gitlabProjectId?: number;
  httpUrlToRepo?: string;
  githubInstallationId?: number;
  githubRepoFullName?: string;
};

export type GitSettingsPublic = {
  github: {
    appId: string | null;
    clientId: string | null;
    clientSecretSet: boolean;
    privateKeySet: boolean;
    webhookSecretSet: boolean;
    /** GitHub App slug; used for the public “install” URL. */
    appSlug: string | null;
    /** Open this on GitHub to grant repo access (after the app is created). */
    installAppUrl: string | null;
  };
  gitlab: {
    baseUrl: string | null;
    groupAccessTokenSet: boolean;
  };
  updatedAt: string | null;
};

/** GitLab project row from GET /api/v4/projects (subset). */
export type GitlabProjectListItem = {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  default_branch: string | null;
};

/** GitHub App manifest (URL-based registration). See GitHub docs: registering a GitHub App using URL parameters. */
export type GithubAppManifestJson = {
  name: string;
  url: string;
  hook_attributes: { url: string };
  redirect_url: string;
  /** GitHub expects `callback_urls` (array); singular `callback_url` is ignored. */
  callback_urls: string[];
  description: string;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
};

/** Row for GET /api/git/github/repositories (merged across installations). */
export type GithubRepoListItem = {
  id: number;
  full_name: string;
  clone_url: string;
  default_branch: string | null;
  private: boolean;
  installation_id: number;
};

@Injectable()
export class GitService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GitIntegrationSettings)
    private readonly repo: Repository<GitIntegrationSettings>,
  ) {}

  async onModuleInit(): Promise<void> {
    return;
  }

  private getEncryptionSecret(): string {
    const s = this.config.get<string>('WEEHAWK_ENCRYPTION_KEY');
    if (!s || !String(s).trim()) {
      throw new BadRequestException(
        'WEEHAWK_ENCRYPTION_KEY is not set. It is required for Git integration secrets.',
      );
    }
    return String(s).trim();
  }

  private decryptSecretOrPlain(value: string | null | undefined): string | null {
    if (!value?.trim()) return null;
    try {
      return decryptPrivateKey(value, this.getEncryptionSecret());
    } catch {
      // Backward compatibility with existing plaintext rows.
      return value;
    }
  }

  private encryptSecret(value: string): string {
    return encryptPrivateKey(value, this.getEncryptionSecret());
  }

  private ensureEncryptedSecret(value: string | null | undefined): string | null {
    const raw = value?.trim();
    if (!raw) return null;
    try {
      decryptPrivateKey(raw, this.getEncryptionSecret());
      return raw;
    } catch {
      try {
        return this.encryptSecret(raw);
      } catch {
        return raw;
      }
    }
  }

  private async migrateRowSecrets(row: GitIntegrationSettings): Promise<GitIntegrationSettings> {
    const nextGithubClientSecret = this.ensureEncryptedSecret(row.githubClientSecret);
    const nextGithubPrivateKey = this.ensureEncryptedSecret(row.githubPrivateKey);
    const nextGithubWebhookSecret = this.ensureEncryptedSecret(row.githubWebhookSecret);
    const nextGitlabApplicationSecret = this.ensureEncryptedSecret(
      row.gitlabApplicationSecret,
    );
    const nextGitlabGroupAccessToken = this.ensureEncryptedSecret(
      row.gitlabGroupAccessToken,
    );
    const changed =
      nextGithubClientSecret !== row.githubClientSecret ||
      nextGithubPrivateKey !== row.githubPrivateKey ||
      nextGithubWebhookSecret !== row.githubWebhookSecret ||
      nextGitlabApplicationSecret !== row.gitlabApplicationSecret ||
      nextGitlabGroupAccessToken !== row.gitlabGroupAccessToken;
    if (!changed) return row;
    row.githubClientSecret = nextGithubClientSecret;
    row.githubPrivateKey = nextGithubPrivateKey;
    row.githubWebhookSecret = nextGithubWebhookSecret;
    row.gitlabApplicationSecret = nextGitlabApplicationSecret;
    row.gitlabGroupAccessToken = nextGitlabGroupAccessToken;
    return this.repo.save(row);
  }

  private async settingsRowForUser(userId: number): Promise<GitIntegrationSettings> {
    let row = await this.repo.findOne({ where: { userId } });
    if (row) return this.migrateRowSecrets(row);
    row = this.repo.create({
      id: userId,
      userId,
      githubAppId: null,
      githubClientId: null,
      githubAppSlug: null,
      githubClientSecret: null,
      githubPrivateKey: null,
      githubWebhookSecret: null,
      gitlabBaseUrl: null,
      gitlabApplicationId: null,
      gitlabApplicationSecret: null,
      gitlabGroupAccessToken: null,
    });
    const saved = await this.repo.save(row);
    return this.migrateRowSecrets(saved);
  }

  private toPublic(row: GitIntegrationSettings): GitSettingsPublic {
    const slug = row.githubAppSlug?.trim() || null;
    return {
      github: {
        appId: row.githubAppId,
        clientId: row.githubClientId,
        clientSecretSet: Boolean(this.decryptSecretOrPlain(row.githubClientSecret)?.trim()),
        privateKeySet: Boolean(this.decryptSecretOrPlain(row.githubPrivateKey)?.trim()),
        webhookSecretSet: Boolean(this.decryptSecretOrPlain(row.githubWebhookSecret)?.trim()),
        appSlug: slug,
        installAppUrl: slug ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` : null,
      },
      gitlab: {
        baseUrl: row.gitlabBaseUrl,
        groupAccessTokenSet: Boolean(this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim()),
      },
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  }

  async getSettings(userId = 1): Promise<GitSettingsPublic> {
    const row = await this.settingsRowForUser(userId);
    await this.refreshGithubAppSlugIfNeeded(row);
    return this.toPublic(row);
  }

  /** Fills `githubAppSlug` via GET /app when credentials exist but slug is missing (older rows). */
  private async refreshGithubAppSlugIfNeeded(row: GitIntegrationSettings): Promise<void> {
    if (row.githubAppSlug?.trim()) return;
    const appId = row.githubAppId?.trim();
    const pem = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
    if (!appId || !pem) return;
    try {
      const appJwt = this.createGithubAppJwt(appId, pem);
      const res = await fetch('https://api.github.com/app', {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${appJwt}`,
          'User-Agent': 'weehawk-api',
        },
      });
      if (!res.ok) return;
      const text = await res.text();
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      const slug = typeof j.slug === 'string' ? j.slug.trim() : '';
      if (slug) {
        row.githubAppSlug = slug;
        await this.repo.save(row);
      }
    } catch {
      /* ignore */
    }
  }

  private applySecret(
    current: string | null,
    incoming: string | undefined,
  ): string | null {
    if (incoming === undefined) return current;
    const t = incoming.trim();
    if (t === '') return null;
    return this.encryptSecret(t);
  }

  async updateSettings(userId = 1, dto: UpdateGitSettingsDto): Promise<GitSettingsPublic> {
    const row = await this.settingsRowForUser(userId);

    if (dto.githubAppId !== undefined) {
      const v = dto.githubAppId.trim();
      row.githubAppId = v === '' ? null : v;
    }
    if (dto.githubClientId !== undefined) {
      const v = dto.githubClientId.trim();
      row.githubClientId = v === '' ? null : v;
    }
    if (dto.githubAppSlug !== undefined) {
      const v = dto.githubAppSlug.trim();
      row.githubAppSlug = v === '' ? null : v;
    }
    if (dto.githubClientSecret !== undefined) {
      row.githubClientSecret = this.applySecret(
        row.githubClientSecret,
        dto.githubClientSecret,
      );
    }
    if (dto.githubPrivateKey !== undefined) {
      row.githubPrivateKey = this.applySecret(
        row.githubPrivateKey,
        dto.githubPrivateKey,
      );
    }
    if (dto.githubWebhookSecret !== undefined) {
      row.githubWebhookSecret = this.applySecret(
        row.githubWebhookSecret,
        dto.githubWebhookSecret,
      );
    }
    if (dto.gitlabBaseUrl !== undefined) {
      const v = dto.gitlabBaseUrl.trim();
      row.gitlabBaseUrl = v === '' ? null : v.replace(/\/+$/, '');
    }
    if (dto.gitlabGroupAccessToken !== undefined) {
      row.gitlabGroupAccessToken = this.applySecret(
        row.gitlabGroupAccessToken,
        dto.gitlabGroupAccessToken,
      );
    }

    await this.repo.save(row);
    return this.toPublic(row);
  }

  private async gitlabSettingsRow(userId = 1): Promise<GitIntegrationSettings> {
    return this.settingsRowForUser(userId);
  }

  /**
   * Build an authenticated HTTPS URL for `git clone` using a GitLab personal or group access token.
   * @see https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html#clone-using-a-token
   */
  static injectGitlabTokenIntoGitHttpUrl(httpUrl: string, token: string): string {
    const u = new URL(httpUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new BadRequestException('Only http(s) Git clone URLs are supported');
    }
    u.username = 'oauth2';
    u.password = token;
    return u.toString();
  }

  /** HTTPS clone URL with embedded credentials (for server-side `git clone`). */
  async gitlabAuthenticatedCloneUrl(httpUrlToRepo: string): Promise<string> {
    const row = await this.gitlabSettingsRow();
    const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    if (!token) {
      throw new BadRequestException(
        'GitLab access token is not configured. Add a group or personal access token in Git → GitLab.',
      );
    }
    const trimmed = httpUrlToRepo.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new BadRequestException('Only http(s) Git clone URLs are supported');
    }
    return GitService.injectGitlabTokenIntoGitHttpUrl(trimmed, token);
  }

  /**
   * URL passed to `git clone`: embed token when set (private repos), otherwise plain HTTPS (public repos).
   */
  async resolveGitlabHttpCloneUrl(httpUrlToRepo: string, userId = 1): Promise<string> {
    const row = await this.gitlabSettingsRow(userId);
    const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    const trimmed = httpUrlToRepo.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new BadRequestException('Only http(s) Git clone URLs are supported');
    }
    if (token) {
      return GitService.injectGitlabTokenIntoGitHttpUrl(trimmed, token);
    }
    return trimmed;
  }

  /**
   * List GitLab projects where the token identity is a member (`membership=true`).
   * Without this, GitLab returns a broad “visible” list including many public projects unrelated to the user.
   * Requires a personal or group access token.
   */
  async listGitlabProjects(userId = 1, params: {
    page?: number;
    perPage?: number;
    search?: string;
  }): Promise<{ projects: GitlabProjectListItem[]; totalPages: number; page: number }> {
    const row = await this.gitlabSettingsRow(userId);
    const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    if (!token) {
      throw new BadRequestException(
        'GitLab access token is not configured. Add a group or personal access token with read_api (and read_repository for private repos) in Git → GitLab.',
      );
    }
    const base = (row.gitlabBaseUrl?.trim() || 'https://gitlab.com').replace(
      /\/+$/,
      '',
    );
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const perPage = Math.min(100, Math.max(1, Math.floor(params.perPage ?? 20)));
    const url = new URL(`${base}/api/v4/projects`);
    url.searchParams.set('membership', 'true');
    url.searchParams.set('order_by', 'last_activity_at');
    url.searchParams.set('sort', 'desc');
    if (params.search?.trim()) {
      url.searchParams.set('search', params.search.trim());
    }
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));

    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        text.trim().slice(0, 800) || `GitLab API error (${res.status})`,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadRequestException('Invalid JSON from GitLab');
    }
    if (!Array.isArray(raw)) {
      throw new BadRequestException('Unexpected GitLab API response');
    }
    const totalPagesRaw = res.headers.get('x-total-pages');
    const totalPages = Math.max(
      1,
      parseInt(totalPagesRaw || '1', 10) || 1,
    );
    const projects: GitlabProjectListItem[] = raw
      .map((p) => {
        const o = p as Record<string, unknown>;
        return {
          id: Number(o.id),
          name: String(o.name ?? ''),
          path_with_namespace: String(o.path_with_namespace ?? ''),
          http_url_to_repo: String(o.http_url_to_repo ?? ''),
          default_branch:
            typeof o.default_branch === 'string' ? o.default_branch : null,
        };
      })
      .filter((p) => p.id > 0 && p.http_url_to_repo.length > 0);

    return { projects, totalPages, page };
  }

  /** Branch names for a GitLab project (`GET .../repository/branches`), paginated. */
  async listGitlabBranchNames(
    userId: number,
    projectId: number,
  ): Promise<{ branches: string[] }> {
    const row = await this.gitlabSettingsRow(userId);
    const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    if (!token) {
      throw new BadRequestException(
        'GitLab access token is not configured. Add a token in Git → GitLab.',
      );
    }
    const base = (row.gitlabBaseUrl?.trim() || 'https://gitlab.com').replace(
      /\/+$/,
      '',
    );
    const branches: string[] = [];
    const seen = new Set<string>();
    let page = 1;
    const maxPages = 30;
    for (; page <= maxPages; page += 1) {
      const url = new URL(
        `${base}/api/v4/projects/${encodeURIComponent(String(projectId))}/repository/branches`,
      );
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const res = await fetch(url, {
        headers: { 'PRIVATE-TOKEN': token },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new BadRequestException(
          text.trim().slice(0, 800) || `GitLab API error (${res.status})`,
        );
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new BadRequestException('Invalid JSON from GitLab (branches)');
      }
      if (!Array.isArray(raw) || raw.length === 0) {
        break;
      }
      for (const item of raw) {
        const o = item as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        if (name && !seen.has(name)) {
          seen.add(name);
          branches.push(name);
        }
      }
      if (raw.length < 100) {
        break;
      }
    }
    branches.sort((a, b) => a.localeCompare(b, 'en'));
    return { branches };
  }

  /** Resolve clone URL and default branch for a GitLab project id (API). */
  async gitlabCloneInfoForProject(projectId: number, userId = 1): Promise<{
    cloneUrl: string;
    defaultBranch: string | null;
  }> {
    const row = await this.gitlabSettingsRow(userId);
    const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    if (!token) {
      throw new BadRequestException(
        'GitLab access token is not configured. Add a group or personal access token in Git → GitLab.',
      );
    }
    const base = (row.gitlabBaseUrl?.trim() || 'https://gitlab.com').replace(
      /\/+$/,
      '',
    );
    const url = `${base}/api/v4/projects/${encodeURIComponent(String(projectId))}`;
    const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token } });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        text.trim().slice(0, 800) || `GitLab API error (${res.status})`,
      );
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON from GitLab');
    }
    const httpUrl = (data.http_url_to_repo as string)?.trim();
    if (!httpUrl) {
      throw new BadRequestException('GitLab project has no HTTP clone URL');
    }
    const defaultBranch =
      typeof data.default_branch === 'string' ? data.default_branch : null;
    const cloneUrl = GitService.injectGitlabTokenIntoGitHttpUrl(
      httpUrl,
      token,
    );
    return { cloneUrl, defaultBranch };
  }

  /**
   * API origin + token for remote `curl` archive downloads.
   * GitLab.com often returns 403 for browser-style `/-/archive/...` URLs with `oauth2:token@`;
   * the REST archive endpoint with `PRIVATE-TOKEN` works reliably.
   */
  async getGitlabArchiveApiCredentials(userId = 1): Promise<{
    apiBase: string;
    privateToken: string;
  } | null> {
    try {
      const row = await this.gitlabSettingsRow(userId);
      const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
      if (!token) return null;
      const base = (row.gitlabBaseUrl?.trim() || 'https://gitlab.com').replace(
        /\/+$/,
        '',
      );
      return { apiBase: base, privateToken: token };
    } catch {
      return null;
    }
  }

  /**
   * Public web origin for GitHub manifest / callbacks. Prefer WEB_ORIGIN; if unset, derive from
   * the incoming request (GitHub GETs the manifest with Host / X-Forwarded-* from your edge).
   */
  private inferPublicOriginFromRequest(req: Request): string | null {
    const host =
      req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('host')?.trim();
    if (!host) return null;

    let proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (!proto) {
      proto = req.secure ? 'https' : undefined;
    }
    if (!proto) {
      const lower = host.toLowerCase();
      const local =
        lower.includes('localhost') ||
        lower.startsWith('127.') ||
        lower.startsWith('[::1]');
      proto = local ? 'http' : 'https';
    }
    return `${proto}://${host}`.replace(/\/+$/, '');
  }

  private resolveManifestWebOrigin(req?: Request): string {
    const envWeb = (this.config.get<string>('WEB_ORIGIN')?.trim() || '').replace(/\/+$/, '');
    const inferred = req ? this.inferPublicOriginFromRequest(req) : null;

    if (envWeb && !this.manifestUrlsLookUnreachableForGithub(envWeb)) {
      return envWeb;
    }
    if (inferred && !this.manifestUrlsLookUnreachableForGithub(inferred)) {
      return inferred;
    }
    if (envWeb) return envWeb;
    if (inferred) return inferred;
    return 'http://localhost:3000';
  }

  private resolveManifestApiBase(req: Request | undefined, manifestWeb: string): string {
    const fromEnv = (this.config.get<string>('API_PUBLIC_URL')?.trim() || '').replace(/\/+$/, '');
    if (fromEnv) return fromEnv;

    const webEnv = (this.config.get<string>('WEB_ORIGIN')?.trim() || '').replace(/\/+$/, '');
    if (webEnv) return webEnv;

    if (manifestWeb && !this.manifestUrlsLookUnreachableForGithub(manifestWeb)) {
      return manifestWeb.replace(/\/+$/, '');
    }

    const port = this.config.get<string>('PORT') ?? '8080';
    return `http://127.0.0.1:${port}`;
  }

  private manifestUrlsLookUnreachableForGithub(hostish: string): boolean {
    const u = hostish.trim().toLowerCase();
    return (
      u.startsWith('http://localhost') ||
      u.startsWith('https://localhost') ||
      u.includes('127.0.0.1') ||
      u.includes('[::1]')
    );
  }

  /**
   * JSON returned at GET /api/git/github/manifest — GitHub fetches this when the user starts
   * “Register GitHub App” from the manifest URL flow.
   */
  buildGithubAppManifest(req?: Request): GithubAppManifestJson {
    const web = this.resolveManifestWebOrigin(req);
    const api = this.resolveManifestApiBase(req, web);
    const callback = `${web}/git/github/callback`;
    const prod =
      (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '')
        .toLowerCase()
        .trim() === 'production';
    if (
      prod &&
      (this.manifestUrlsLookUnreachableForGithub(web) ||
        this.manifestUrlsLookUnreachableForGithub(api))
    ) {
      throw new InternalServerErrorException(
        'GitHub App manifest URLs point to localhost. In production set WEB_ORIGIN (e.g. https://app.weehawk.io) and API_PUBLIC_URL to the public HTTPS base that serves this API (same host or api subdomain).',
      );
    }
    return {
      name: 'Weehawk',
      url: web,
      description: 'Weehawk platform — Git source for application services',
      hook_attributes: {
        url: `${api}/api/git/github/webhook`,
      },
      redirect_url: callback,
      callback_urls: [callback],
      public: false,
      default_permissions: {
        contents: 'read',
        metadata: 'read',
      },
      default_events: [],
    };
  }

  /**
   * Registers a GitHub repository webhook (push events) using an installation access token.
   * Points to the given URL (typically the remote server's webhook agent).
   * @returns The GitHub hook id
   */
  async createGithubRepoWebhook(params: {
    installationId: number;
    repoFullName: string;
    url: string;
    secret?: string;
  }): Promise<number> {
    const row = await this.githubAppCredentialsRow();
    const appId = row.githubAppId?.trim();
    const privateKey = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
    if (!appId || !privateKey) {
      throw new BadRequestException(
        'GitHub App is not configured. Register the app under Git → GitHub (App ID and private key required).',
      );
    }
    const appJwt = this.createGithubAppJwt(
      appId,
      privateKey,
    );
    const instTok = await this.githubInstallationAccessToken(
      params.installationId,
      appJwt,
    );
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(params.repoFullName)}/hooks`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${instTok}`,
          'User-Agent': 'weehawk-api',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url: params.url,
            content_type: 'json',
            ...(params.secret ? { secret: params.secret } : {}),
          },
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        text.trim().slice(0, 800) || `GitHub create hook failed (${res.status})`,
      );
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON from GitHub (create hook)');
    }
    const id = Number(data.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('GitHub did not return a hook id');
    }
    return id;
  }

  /** Deletes a GitHub repository webhook; ignores 404. */
  async deleteGithubRepoWebhook(
    installationId: number,
    repoFullName: string,
    hookId: number,
  ): Promise<void> {
    try {
      const row = await this.githubAppCredentialsRow();
      const appId = row.githubAppId?.trim();
      const privateKey = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
      if (!appId || !privateKey) return;
      const appJwt = this.createGithubAppJwt(
        appId,
        privateKey,
      );
      const instTok = await this.githubInstallationAccessToken(
        installationId,
        appJwt,
      );
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repoFullName)}/hooks/${encodeURIComponent(String(hookId))}`,
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${instTok}`,
            'User-Agent': 'weehawk-api',
          },
        },
      );
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        throw new BadRequestException(
          text.trim().slice(0, 800) || `GitHub delete hook failed (${res.status})`,
        );
      }
    } catch {
      /* best effort */
    }
  }

  /**
   * Registers a GitLab project hook for push events (PRIVATE-TOKEN auth).
   * @returns New hook id
   */
  async createGitlabPushWebhook(params: {
    projectId: number;
    url: string;
    token: string;
    userId?: number;
  }): Promise<number> {
    const row = await this.gitlabSettingsRow(params.userId ?? 1);
    const privateToken = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    if (!privateToken) {
      throw new BadRequestException(
        'GitLab token is not configured. Add it under Git → GitLab.',
      );
    }
    const base = (row.gitlabBaseUrl?.trim() || 'https://gitlab.com').replace(
      /\/+$/,
      '',
    );
    const res = await fetch(
      `${base}/api/v4/projects/${encodeURIComponent(String(params.projectId))}/hooks`,
      {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': privateToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: params.url,
          push_events: true,
          token: params.token,
          enable_ssl_verification: true,
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      const raw = text.trim().slice(0, 800);
      try {
        const errJson = JSON.parse(text) as { error?: string };
        if (errJson.error === 'insufficient_scope') {
          throw new BadRequestException(
            'GitLab: the access token needs the `api` scope to register webhooks. Open Git → GitLab in Weehawk and save a personal or group access token that includes `api` (alongside read_api / read_repository as needed).',
          );
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
      }
      throw new BadRequestException(
        raw || `GitLab create hook failed (${res.status})`,
      );
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON from GitLab (create hook)');
    }
    const id = Number(data.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('GitLab did not return a hook id');
    }
    return id;
  }

  /** Deletes a project hook; ignores 404. */
  async deleteGitlabProjectWebhook(
    projectId: number,
    hookId: number,
  ): Promise<void> {
    const row = await this.gitlabSettingsRow();
    const privateToken = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    if (!privateToken) {
      return;
    }
    const base = (row.gitlabBaseUrl?.trim() || 'https://gitlab.com').replace(
      /\/+$/,
      '',
    );
    const res = await fetch(
      `${base}/api/v4/projects/${encodeURIComponent(String(projectId))}/hooks/${encodeURIComponent(String(hookId))}`,
      {
        method: 'DELETE',
        headers: { 'PRIVATE-TOKEN': privateToken },
      },
    );
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new BadRequestException(
        text.trim().slice(0, 800) || `GitLab delete hook failed (${res.status})`,
      );
    }
  }

  /**
   * Exchanges the temporary code from GitHub after manifest registration and persists credentials.
   * @see https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-a-github-app-from-a-manifest
   */
  async exchangeGithubManifestCode(userId = 1, code: string): Promise<GitSettingsPublic> {
    const trimmed = code?.trim();
    if (!trimmed) {
      throw new BadRequestException('Missing manifest code');
    }

    const res = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(trimmed)}/conversions`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        text.trim() || `GitHub manifest exchange failed (${res.status})`,
      );
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON from GitHub');
    }

    const id = data['id'];
    const clientId = data['client_id'];
    const clientSecret = data['client_secret'];
    const pem = data['pem'];
    const webhookSecret = data['webhook_secret'];

    const row = await this.settingsRowForUser(userId);

    if (typeof id === 'number' || typeof id === 'string') {
      row.githubAppId = String(id);
    }
    if (typeof clientId === 'string' && clientId.trim()) {
      row.githubClientId = clientId.trim();
    }
    const slugRaw = data['slug'];
    if (typeof slugRaw === 'string' && slugRaw.trim()) {
      row.githubAppSlug = slugRaw.trim();
    }
    if (typeof clientSecret === 'string' && clientSecret.trim()) {
      row.githubClientSecret = this.encryptSecret(clientSecret.trim());
    }
    if (typeof pem === 'string' && pem.trim()) {
      row.githubPrivateKey = this.encryptSecret(pem.trim());
    }
    if (typeof webhookSecret === 'string' && webhookSecret.trim()) {
      row.githubWebhookSecret = this.encryptSecret(webhookSecret.trim());
    }

    await this.repo.save(row);
    await this.refreshGithubAppSlugIfNeeded(row);
    return this.toPublic(row);
  }

  // ─── GitHub App (installation token + repo list + clone) ─────────────────

  private async githubAppCredentialsRow(userId = 1): Promise<GitIntegrationSettings> {
    const row = await this.gitlabSettingsRow(userId);
    const appId = row.githubAppId?.trim();
    const pem = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
    if (!appId || !pem) {
      throw new BadRequestException(
        'GitHub App is not configured. Register the app under Git → GitHub (App ID and private key required).',
      );
    }
    return row;
  }

  /**
   * Return the GitHub App credentials needed for remote self-service token generation.
   * Returns null when the App is not configured (public repos only).
   */
  async getGithubAppPublicCredentials(): Promise<{ appId: string; privateKeyPem: string } | null> {
    try {
      const row = await this.githubAppCredentialsRow();
      const appId = row.githubAppId?.trim();
      const pem = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
      if (!appId || !pem) return null;
      return { appId, privateKeyPem: pem };
    } catch {
      return null;
    }
  }

  private static base64UrlJson(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  /** Short-lived JWT to call GitHub as the App (RS256). */
  private createGithubAppJwt(appId: string, privateKeyPem: string): string {
    const header = GitService.base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const now = Math.floor(Date.now() / 1000);
    const payload = GitService.base64UrlJson({
      iat: now - 60,
      exp: now + 300,
      iss: appId,
    });
    const data = `${header}.${payload}`;
    const sign = createSign('RSA-SHA256');
    sign.update(data);
    sign.end();
    const sig = sign.sign(privateKeyPem);
    const signature = sig
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `${data}.${signature}`;
  }

  private static parseGithubNextUrl(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const parts = linkHeader.split(',');
    for (const p of parts) {
      const m = p.match(/<([^>]+)>;\s*rel="next"/);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  }

  private async githubFetchJson(
    url: string,
    bearer: string,
  ): Promise<{ status: number; text: string }> {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${bearer}`,
        'User-Agent': 'weehawk-api',
      },
    });
    const text = await res.text();
    return { status: res.status, text };
  }

  private async githubInstallationAccessToken(
    installationId: number,
    appJwt: string,
  ): Promise<string> {
    const url = `https://api.github.com/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${appJwt}`,
        'User-Agent': 'weehawk-api',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        text.trim().slice(0, 800) || `GitHub token error (${res.status})`,
      );
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON from GitHub (installation token)');
    }
    const tok = data.token;
    if (typeof tok !== 'string' || !tok.trim()) {
      throw new BadRequestException('GitHub did not return an installation token');
    }
    return tok.trim();
  }

  static injectGithubInstallationTokenIntoGitHttpUrl(
    httpUrl: string,
    token: string,
  ): string {
    const u = new URL(httpUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new BadRequestException('Only http(s) Git clone URLs are supported');
    }
    u.username = 'x-access-token';
    u.password = token;
    return u.toString();
  }

  /**
   * Clone URL with installation token (private repos). Resolves default branch from the API when needed.
   */
  async githubCloneInfoForInstallationRepo(
    installationId: number,
    fullName: string,
  ): Promise<{ cloneUrl: string; defaultBranch: string | null }> {
    const row = await this.githubAppCredentialsRow();
    const appId = row.githubAppId?.trim();
    const privateKey = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
    if (!appId || !privateKey) {
      throw new BadRequestException(
        'GitHub App is not configured. Register the app under Git → GitHub (App ID and private key required).',
      );
    }
    const appJwt = this.createGithubAppJwt(
      appId,
      privateKey,
    );
    const instTok = await this.githubInstallationAccessToken(
      installationId,
      appJwt,
    );
    const fn = fullName.trim();
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(fn)) {
      throw new BadRequestException(
        'githubRepoFullName must look like owner/repo (letters, numbers, ._-).',
      );
    }
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(fn)}`;
    const { status, text } = await this.githubFetchJson(apiUrl, instTok);
    if (!status.toString().startsWith('2')) {
      throw new BadRequestException(
        text.trim().slice(0, 800) || `GitHub repo error (${status})`,
      );
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON from GitHub (repository)');
    }
    const cloneUrlRaw = (data.clone_url as string)?.trim();
    if (!cloneUrlRaw) {
      throw new BadRequestException('GitHub repository has no clone_url');
    }
    const defaultBranch =
      typeof data.default_branch === 'string' ? data.default_branch : null;
    const cloneUrl = GitService.injectGithubInstallationTokenIntoGitHttpUrl(
      cloneUrlRaw,
      instTok,
    );
    return { cloneUrl, defaultBranch };
  }

  /**
   * Repositories across all installations of this GitHub App (paginated after merge + optional search).
   */
  async listGithubRepositories(userId = 1, params: {
    page?: number;
    perPage?: number;
    search?: string;
  }): Promise<{
    repositories: GithubRepoListItem[];
    totalPages: number;
    page: number;
  }> {
    const row = await this.githubAppCredentialsRow(userId);
    const appId = row.githubAppId?.trim();
    const privateKey = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
    if (!appId || !privateKey) {
      throw new BadRequestException(
        'GitHub App is not configured. Register the app under Git → GitHub (App ID and private key required).',
      );
    }
    const appJwt = this.createGithubAppJwt(
      appId,
      privateKey,
    );

    const merged = new Map<number, GithubRepoListItem>();

    let instUrl: string | null =
      'https://api.github.com/app/installations?per_page=100';
    const installationIds: number[] = [];
    while (instUrl) {
      const res = await fetch(instUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${appJwt}`,
          'User-Agent': 'weehawk-api',
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new BadRequestException(
          text.trim().slice(0, 800) ||
            `GitHub installations error (${res.status})`,
        );
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new BadRequestException('Invalid JSON from GitHub (installations)');
      }
      if (!Array.isArray(raw)) {
        throw new BadRequestException('Unexpected GitHub installations response');
      }
      for (const item of raw) {
        const o = item as Record<string, unknown>;
        const id = Number(o.id);
        if (id > 0) installationIds.push(id);
      }
      instUrl = GitService.parseGithubNextUrl(res.headers.get('link'));
    }

    for (const iid of installationIds) {
      let instTok: string;
      try {
        instTok = await this.githubInstallationAccessToken(iid, appJwt);
      } catch {
        continue;
      }
      let repoUrl: string | null =
        'https://api.github.com/installation/repositories?per_page=100';
      while (repoUrl) {
        const res = await fetch(repoUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${instTok}`,
            'User-Agent': 'weehawk-api',
          },
        });
        const text = await res.text();
        if (!res.ok) {
          break;
        }
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          break;
        }
        const repos = data.repositories;
        if (!Array.isArray(repos)) break;
        for (const r of repos) {
          const o = r as Record<string, unknown>;
          const id = Number(o.id);
          const full_name = String(o.full_name ?? '').trim();
          const clone_url = String(o.clone_url ?? '').trim();
          if (id <= 0 || !full_name || !clone_url) continue;
          merged.set(id, {
            id,
            full_name,
            clone_url,
            default_branch:
              typeof o.default_branch === 'string' ? o.default_branch : null,
            private: o.private === true,
            installation_id: iid,
          });
        }
        repoUrl = GitService.parseGithubNextUrl(res.headers.get('link'));
      }
    }

    let list = [...merged.values()].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, 'en'),
    );
    const q = params.search?.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.full_name.toLowerCase().includes(q));
    }

    const perPage = Math.min(100, Math.max(1, Math.floor(params.perPage ?? 20)));
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const slice = list.slice((page - 1) * perPage, page * perPage);

    return { repositories: slice, totalPages, page };
  }

  /** Branch names for a GitHub repo using an installation access token. */
  async listGithubBranchNames(
    userId: number,
    installationId: number,
    fullName: string,
  ): Promise<{ branches: string[] }> {
    const fn = fullName.trim();
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(fn)) {
      throw new BadRequestException(
        'repo must look like owner/name (letters, numbers, ._-).',
      );
    }
    const row = await this.githubAppCredentialsRow(userId);
    const appId = row.githubAppId?.trim();
    const privateKey = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
    if (!appId || !privateKey) {
      throw new BadRequestException(
        'GitHub App is not configured. Register the app under Git → GitHub.',
      );
    }
    const appJwt = this.createGithubAppJwt(appId, privateKey);
    const instTok = await this.githubInstallationAccessToken(
      installationId,
      appJwt,
    );
    const branches: string[] = [];
    const seen = new Set<string>();
    let page = 1;
    const maxPages = 30;
    for (; page <= maxPages; page += 1) {
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(fn)}/branches?per_page=100&page=${page}`;
      const { status, text } = await this.githubFetchJson(apiUrl, instTok);
      if (!status.toString().startsWith('2')) {
        throw new BadRequestException(
          text.trim().slice(0, 800) || `GitHub branches error (${status})`,
        );
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new BadRequestException('Invalid JSON from GitHub (branches)');
      }
      if (!Array.isArray(raw) || raw.length === 0) {
        break;
      }
      for (const item of raw) {
        const o = item as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        if (name && !seen.has(name)) {
          seen.add(name);
          branches.push(name);
        }
      }
      if (raw.length < 100) {
        break;
      }
    }
    branches.sort((a, b) => a.localeCompare(b, 'en'));
    return { branches };
  }

  /** Web UI base (may include subpath, e.g. https://company.com/gitlab). */
  private normalizeGitlabWebBase(raw: string): string {
    const t = (raw?.trim() || 'https://gitlab.com').replace(/\/+$/, '');
    const u = new URL(t.startsWith('http') ? t : `https://${t}`);
    const p = u.pathname.replace(/\/+$/, '');
    const path = !p || p === '/' ? '' : p;
    return `${u.origin}${path}`;
  }

  private gitlabJsonHeaders(token: string): Record<string, string> {
    return {
      'PRIVATE-TOKEN': token,
      Accept: 'application/json',
      'User-Agent': 'weehawk-api',
    };
  }

  /**
   * API root for v4 (same host as configured Git → GitLab base when host matches clone URL).
   * Manual clone URLs on subdirectory installs were using `origin` only and hit the wrong path.
   */
  private resolveGitlabApiRootFromCloneUrl(
    row: GitIntegrationSettings,
    cloneUrl: string,
  ): string {
    let clone: URL;
    try {
      clone = new URL(cloneUrl);
    } catch {
      throw new BadRequestException('Invalid GitLab URL');
    }
    const configured = this.normalizeGitlabWebBase(
      row.gitlabBaseUrl?.trim() || 'https://gitlab.com',
    );
    let cfgParsed: URL;
    try {
      cfgParsed = new URL(configured);
    } catch {
      return clone.origin;
    }
    if (clone.hostname.toLowerCase() !== cfgParsed.hostname.toLowerCase()) {
      return clone.origin;
    }
    return configured;
  }

  /** Strip GitLab relative URL root from repo path (e.g. /gitlab/ns/r → ns/r). */
  private gitlabProjectPathFromClonePathname(
    row: GitIntegrationSettings,
    cloneUrl: string,
  ): string {
    const u = new URL(cloneUrl);
    let pathPart = u.pathname
      .replace(/^\//, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    if (!pathPart) {
      throw new BadRequestException('Invalid GitLab repository URL');
    }
    const configured = this.normalizeGitlabWebBase(
      row.gitlabBaseUrl?.trim() || 'https://gitlab.com',
    );
    let cfgParsed: URL;
    try {
      cfgParsed = new URL(configured);
    } catch {
      return pathPart;
    }
    if (u.hostname.toLowerCase() !== cfgParsed.hostname.toLowerCase()) {
      return pathPart;
    }
    const mount = cfgParsed.pathname.replace(/\/+$/, '').replace(/^\//, '');
    if (
      mount &&
      pathPart.toLowerCase().startsWith(mount.toLowerCase() + '/')
    ) {
      pathPart = pathPart.slice(mount.length + 1);
    }
    return pathPart;
  }

  private assertSingleGitApplicationSource(options: {
    gitlabProjectId?: number;
    httpUrlToRepo?: string;
    githubInstallationId?: number;
    githubRepoFullName?: string;
  }): void {
    const hasGitlabId =
      options.gitlabProjectId != null && options.gitlabProjectId > 0;
    const hasUrl = Boolean(options.httpUrlToRepo?.trim());
    const ghInst =
      options.githubInstallationId != null && options.githubInstallationId > 0;
    const ghName = Boolean(options.githubRepoFullName?.trim());
    if (ghInst !== ghName) {
      throw new BadRequestException(
        'githubInstallationId and githubRepoFullName must be sent together.',
      );
    }
    const hasGithub = ghInst && ghName;
    const modes = [hasGitlabId, hasUrl, hasGithub].filter(Boolean).length;
    if (modes !== 1) {
      throw new BadRequestException(
        'Send exactly one source: gitlabProjectId, httpUrlToRepo, or githubInstallationId + githubRepoFullName.',
      );
    }
  }

  /**
   * Resolve the git ref via provider JSON APIs only (no repo body on the control plane, no local `git`).
   * Persist {@link WeehawkRemoteGitMarkerV1} in `dockerConfig` headers on the service (see services layer).
   */
  async resolveRemoteGitApplicationBinding(
    options: {
      gitlabProjectId?: number;
      httpUrlToRepo?: string;
      githubInstallationId?: number;
      githubRepoFullName?: string;
      branch?: string;
    },
    userId = 1,
  ): Promise<{ refUsed: string; marker: WeehawkRemoteGitMarkerV1 }> {
    this.assertSingleGitApplicationSource(options);
    const marker = await this.resolveRemoteGitMarker(options, userId);
    return { refUsed: marker.ref, marker };
  }

  private async resolveRemoteGitMarker(
    options: {
      gitlabProjectId?: number;
      httpUrlToRepo?: string;
      githubInstallationId?: number;
      githubRepoFullName?: string;
      branch?: string;
    },
    userId: number,
  ): Promise<WeehawkRemoteGitMarkerV1> {
    const requestedBranch = options.branch?.trim() || null;

    if (options.gitlabProjectId != null && options.gitlabProjectId > 0) {
      const row = await this.gitlabSettingsRow(userId);
      const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
      if (!token) {
        throw new BadRequestException(
          'GitLab access token is not configured. Add a group or personal access token in Git → GitLab.',
        );
      }
      const base = this.normalizeGitlabWebBase(
        row.gitlabBaseUrl?.trim() || 'https://gitlab.com',
      );
      let ref = requestedBranch;
      if (!ref) {
        const metaUrl = `${base}/api/v4/projects/${encodeURIComponent(String(options.gitlabProjectId))}`;
        const res = await fetch(metaUrl, { headers: this.gitlabJsonHeaders(token) });
        const text = await res.text();
        if (!res.ok) {
          throw new BadRequestException(
            text.trim().slice(0, 800) || `GitLab API error (${res.status})`,
          );
        }
        const data = JSON.parse(text) as Record<string, unknown>;
        ref =
          typeof data.default_branch === 'string' ? data.default_branch : 'main';
      }
      return {
        v: 1,
        provider: 'gitlab',
        ref,
        gitlabProjectId: options.gitlabProjectId,
      };
    }

    if (
      options.githubInstallationId != null &&
      options.githubInstallationId > 0 &&
      options.githubRepoFullName
    ) {
      const row = await this.githubAppCredentialsRow(userId);
      const appId = row.githubAppId?.trim();
      const privateKey = this.decryptSecretOrPlain(row.githubPrivateKey)?.trim();
      if (!appId || !privateKey) {
        throw new BadRequestException(
          'GitHub App is not configured. Register the app under Git → GitHub (App ID and private key required).',
        );
      }
      const fn = options.githubRepoFullName.trim();
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(fn)) {
        throw new BadRequestException(
          'githubRepoFullName must look like owner/repo (letters, numbers, ._-).',
        );
      }
      const appJwt = this.createGithubAppJwt(appId, privateKey);
      const instTok = await this.githubInstallationAccessToken(
        options.githubInstallationId,
        appJwt,
      );
      let ref = requestedBranch;
      if (!ref) {
        const apiUrl = `https://api.github.com/repos/${encodeURIComponent(fn)}`;
        const { status, text } = await this.githubFetchJson(apiUrl, instTok);
        if (!status.toString().startsWith('2')) {
          throw new BadRequestException(
            text.trim().slice(0, 800) || `GitHub repo error (${status})`,
          );
        }
        const data = JSON.parse(text) as Record<string, unknown>;
        ref =
          typeof data.default_branch === 'string' ? data.default_branch : 'main';
      }
      return {
        v: 1,
        provider: 'github',
        ref,
        githubInstallationId: options.githubInstallationId,
        githubRepoFullName: fn,
      };
    }

    const trimmed = options.httpUrlToRepo?.trim();
    if (!trimmed) {
      throw new BadRequestException('No git source resolved');
    }

    let host: string;
    try {
      host = new URL(trimmed).hostname.toLowerCase();
    } catch {
      throw new BadRequestException('Invalid clone URL');
    }

    if (host === 'github.com') {
      const u = new URL(trimmed);
      const parts = u.pathname
        .replace(/^\//, '')
        .replace(/\.git$/i, '')
        .split('/')
        .filter(Boolean);
      if (parts.length < 2) {
        throw new BadRequestException('Could not parse owner/repo from GitHub URL');
      }
      const owner = parts[0];
      const repo = parts[1];
      let ref = requestedBranch;
      if (!ref) {
        const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
        const res = await fetch(apiUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'weehawk-api',
          },
        });
        const text = await res.text();
        if (!res.ok) {
          throw new BadRequestException(
            text.trim().slice(0, 800) || `GitHub repo error (${res.status})`,
          );
        }
        const data = JSON.parse(text) as Record<string, unknown>;
        ref =
          typeof data.default_branch === 'string' ? data.default_branch : 'main';
      }
      return {
        v: 1,
        provider: 'github',
        ref,
        httpUrlToRepo: trimmed,
      };
    }

    const row = await this.gitlabSettingsRow(userId);
    const token = this.decryptSecretOrPlain(row.gitlabGroupAccessToken)?.trim();
    const apiBase = this.resolveGitlabApiRootFromCloneUrl(row, trimmed);
    const pathPart = this.gitlabProjectPathFromClonePathname(row, trimmed);
    let ref = requestedBranch;
    if (!ref) {
      if (!token) {
        throw new BadRequestException(
          'GitLab access token is required to resolve the default branch for this URL.',
        );
      }
      const metaUrl = `${apiBase}/api/v4/projects/${encodeURIComponent(pathPart)}`;
      const res = await fetch(metaUrl, { headers: this.gitlabJsonHeaders(token) });
      const text = await res.text();
      if (!res.ok) {
        throw new BadRequestException(
          text.trim().slice(0, 800) || `GitLab API error (${res.status})`,
        );
      }
      const data = JSON.parse(text) as Record<string, unknown>;
      ref =
        typeof data.default_branch === 'string' ? data.default_branch : 'main';
    }
    return {
      v: 1,
      provider: 'gitlab',
      ref,
      httpUrlToRepo: trimmed,
    };
  }
}
