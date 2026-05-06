import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { generatePublicId } from '../common/public-id';
import Dockerode from 'dockerode';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { RemoteServer } from './entities/remote-server.entity';
import { CreateRemoteServerDto } from './dto/create-remote-server.dto';
import { UpdateRemoteServerDto } from './dto/update-remote-server.dto';
import { Service } from '../services/entities/service.entity';
import { Project } from '../projects/entities/project.entity';
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
import {
  buildRemoteEnvAndWrappedShInstallScript,
  buildRemoteNotificationCredentialEnvLines,
  remoteInstallShQuote,
  remoteNotifyDispatchFunctionsBashStrict,
  REMOTE_NOTIFY_DEFAULTS_WEBHOOK,
} from '../common/remote-wrapped-script-install';
import type { NotificationChannelRuntimeConfig } from '../notifications/notification.service';
import type { ProviderSendResult } from '../notifications/providers/provider.types';
import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik/traefik.constants';
import { TraefikService } from '../traefik/traefik.service';
import { WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE } from './weehawk-webhook-agent.constants';
import type { WebhookAgentProvisionInput } from './remote-server-provision.script';
import { toSafePathSegment } from '../services/deployment-paths';
import { isLoopbackSshHost } from './loopback-ssh-host';
import { sshHostKeySha256Fingerprint, sshHostKeysEqual } from './ssh-host-key';
import {
  assertPublicRemoteIpv4Literal,
  assertPublicRemoteSshHost,
} from './remote-ssh-host-policy';
import { OrganizationResourceScopedRepository } from '../common/tenant-scoped.service';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';
import { OrgRealtimeEmitter } from '../org-realtime/org-realtime-emitter.service';

/**
 * Bash-safe `export VAR='…'` lines so `docker stack deploy` can substitute `${VAR}` in the compose
 * file on the remote host (matches local deploy where service.env is merged into the process env).
 */
function bashExportBlockForStackDeploy(env: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!k || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    const quoted = `'${String(v ?? '').replace(/'/g, `'\\''`)}'`;
    lines.push(`export ${k}=${quoted}`);
  }
  return lines.join('\n');
}

/**
 * Maps common Node/ssh2/Dockerode errors to clearer copy; keeps the original for debugging.
 */
function humanizeRemoteTestError(raw: string, mode: 'docker' | 'ssh'): string {
  const t = (raw || '').trim();
  const lower = t.toLowerCase();
  const tech = t ? `\n\nTechnical: ${t}` : '';

  if (
    lower.includes('socket hang up') ||
    lower.includes('econnreset') ||
    lower.includes('connection reset')
  ) {
    return (
      (mode === 'docker'
        ? 'The connection closed unexpectedly while reaching the remote Docker API over SSH. Typical causes: wrong host or port; firewall blocking SSH; Docker Engine not installed or not running on the host; or the SSH session dropped before Docker answered. Run the SSH-only test: if that fails, fix SSH first; if SSH passes, install/start Docker on the server.'
        : 'The connection closed unexpectedly during SSH. Typical causes: wrong host or port; firewall or security group blocking port 22 (or your custom port); sshd not running; or an unstable network between the Weehawk API and the server.') +
      tech
    );
  }

  if (
    lower.includes('etimedout') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('readytimeout')
  ) {
    return (
      (mode === 'docker'
        ? 'Timed out talking to the remote host over SSH/Docker. Check the host is up, the port is correct, and nothing is blocking the path from the API server.'
        : 'SSH connection timed out. Check the host is reachable from the machine running the Weehawk API, DNS resolves, and the SSH port is open.') +
      tech
    );
  }

  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return (
      (mode === 'docker'
        ? 'Nothing accepted the connection on that host:port (connection refused). Confirm the SSH port and that sshd is listening.'
        : 'Connection refused — no service accepted TCP on that host:port. Verify the SSH port and that sshd is running.') +
      tech
    );
  }

  if (
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('name or service not known')
  ) {
    return `Host name could not be resolved (DNS or invalid hostname). Check the host string.${tech}`;
  }

  if (
    lower.includes('authentication') ||
    lower.includes('all configured authentication methods failed') ||
    lower.includes('permission denied (publickey')
  ) {
    return (
      (mode === 'docker'
        ? 'SSH authentication failed before Docker could be reached. Ensure this server’s public key is in ~/.ssh/authorized_keys for the SSH user, and the private key in Weehawk matches.'
        : 'SSH authentication failed. Ensure the public key is in ~/.ssh/authorized_keys on the server for this user, and the private key stored in Weehawk is the matching pair.') +
      tech
    );
  }

  if (
    lower.includes('hostkey') ||
    lower.includes('host key') ||
    lower.includes('verification') ||
    lower.includes('not verified') ||
    lower.includes('man-in-the-middle')
  ) {
    return (
      'SSH host key verification failed — the server key does not match the fingerprint stored for this remote server (possible MITM or the host key was rotated). Update the server host/port to clear the saved fingerprint, or fix sshd keys on the target. Compare with `ssh-keyscan -p <port> <host>` / `ssh-keygen -lf -E sha256`.' +
      tech
    );
  }

  return t.length > 0 ? t : 'Unknown error';
}

/** Bash scripts for webhooks are uploaded here for the on-host Go webhook agent. */
export const WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR =
  '/opt/weehawk-scripts/webhooks';

/**
 * After each remote stack deploy, the compose bundle is copied here so redeploy webhooks can run
 * `docker stack deploy` / `docker compose` on the host without calling the Weehawk API.
 */
export const WEEHAWK_REMOTE_DEPLOYMENTS_BASE = '/opt/weehawk-deployments';

const WEEHAWK_WEBHOOK_SWARM_SERVICE_NAME = 'weehawk-webhook-agent';

function shSingleQuoteRemote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function normalizeHooksPublicHosts(hosts: string[]): string[] {
  const out = new Set<string>();
  for (const h of hosts) {
    const t = h.trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out].sort();
}

/** Traefik rule fragment: `(Host(\`a\`) || Host(\`b\`)) && PathPrefix(\`/weehawk-hooks\`)` */
function buildTraefikHostRuleForWebhookAgent(
  hosts: string[],
  pathPrefix: string,
): string {
  const n = normalizeHooksPublicHosts(hosts);
  if (n.length === 0) return '';
  const hostRule = n
    .map((h) => `Host(\`${h.replace(/`/g, '')}\`)`)
    .join(' || ');
  const normalizedPrefix =
    `/${(pathPrefix || '').trim().replace(/^\/+|\/+$/g, '')}`.replace(
      /\/+/g,
      '/',
    );
  return `(${hostRule}) && PathPrefix(\`${normalizedPrefix}\`)`;
}

export type RemoteServerSafe = {
  id: number;
  publicId?: string;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  serverRole: 'deploy' | 'build';
  /** How SSH identity is provided (never exposes raw PEM or ciphertext). */
  authMode: 'stored' | 'none';
  /** True when an encrypted key is stored in the database. */
  hasPrivateKey: boolean;
  /** Public IPv4 for Magic Traefik.me hostnames (optional). */
  publicIpv4: string | null;
  /** Optional JSON: domain labels / metadata (primarily for deploy servers). */
  domainsJson: string | null;
  /** OpenSSH SHA256 host key fingerprint when trust-on-first-use has run; null until first successful SSH. */
  sshHostKeySha256: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const DOMAINS_JSON_MAX_LEN = 65_535;

function normalizeDomainsJsonInput(raw: string | undefined): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  if (t.length > DOMAINS_JSON_MAX_LEN) {
    throw new BadRequestException('domainsJson exceeds maximum length');
  }
  try {
    JSON.parse(t);
  } catch {
    throw new BadRequestException('domainsJson must be valid JSON');
  }
  return t;
}

/** Best-effort count of hostname labels in `domainsJson` (array, `{ domains: [] }`, or string values). */
function countDomainLabelsInDomainsJson(raw: string | null): number {
  if (raw == null || !String(raw).trim()) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null) return 0;
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => typeof x === 'string' && x.trim()).length;
    }
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      if (Array.isArray(o.domains)) {
        return o.domains.filter((x) => typeof x === 'string' && x.trim()).length;
      }
      return Object.values(o).filter(
        (v) => typeof v === 'string' && String(v).trim(),
      ).length;
    }
    return 0;
  } catch {
    return 0;
  }
}

@Injectable()
export class RemoteServersService {
  private readonly logger = new Logger(RemoteServersService.name);
  /**
   * Serialize Swarm webhook-agent deploys per remote server so concurrent API calls
   * do not race on `docker service rm` / `docker service create` (AlreadyExists).
   */
  private readonly webhookSwarmRecreateChainByServerId = new Map<
    number,
    Promise<void>
  >();

  /** Observed host key from last verifier run (trust-on-first-use), keyed by remote server id. */
  private readonly pendingSshHostKeyByServerId = new Map<number, string>();
  private readonly scopedRemoteServers: OrganizationResourceScopedRepository<RemoteServer>;

  constructor(
    @InjectRepository(RemoteServer)
    private readonly remoteServerRepository: Repository<RemoteServer>,
    @InjectRepository(OrganizationMembership)
    private readonly organizationMembershipRepository: Repository<OrganizationMembership>,
    private readonly configService: ConfigService,
    private readonly traefikService: TraefikService,
    private readonly organizationsService: OrganizationsService,
    private readonly orgRealtime: OrgRealtimeEmitter,
  ) {
    this.scopedRemoteServers = new OrganizationResourceScopedRepository<RemoteServer>(
      this.remoteServerRepository,
      this.organizationMembershipRepository,
      'Remote server',
    );
  }

  private runWebhookSwarmOpSerialized(
    remoteServerId: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    const prev =
      this.webhookSwarmRecreateChainByServerId.get(remoteServerId) ??
      Promise.resolve();
    const next = prev.then(fn, fn);
    this.webhookSwarmRecreateChainByServerId.set(
      remoteServerId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /**
   * Ensures a remote host used at deploy/build time belongs to the project's organization.
   */
  assertRemoteServerMatchesProject(
    rs: RemoteServer | null | undefined,
    projectOrganizationId: number | null,
  ): void {
    if (!rs) {
      throw new NotFoundException('Remote server not found');
    }
    if (projectOrganizationId == null) {
      return;
    }
    if (rs.organizationId !== projectOrganizationId) {
      throw new NotFoundException('Remote server not found');
    }
  }

  private async resolveProjectScope(service: Service): Promise<{
    userId: number | null;
    organizationId: number | null;
  }> {
    const p = service.project;
    if (p?.organizationId != null) {
      return {
        userId: null,
        organizationId: p.organizationId,
      };
    }
    const projectId =
      typeof (service as Service & { projectId?: number }).projectId ===
      'number'
        ? (service as Service & { projectId?: number }).projectId
        : (service.project as { id?: number } | undefined)?.id;
    if (!projectId) return { userId: null, organizationId: null };
    const project = await this.remoteServerRepository.manager
      .getRepository(Project)
      .findOne({
        where: { id: projectId },
        select: { organizationId: true },
      });
    return {
      userId: null,
      organizationId: project?.organizationId ?? null,
    };
  }

  private getEncryptionSecret(): string {
    const s = this.configService.get<string>('WEEHAWK_ENCRYPTION_KEY');
    if (!s || !String(s).trim()) {
      throw new BadRequestException(
        'WEEHAWK_ENCRYPTION_KEY is not set in the API environment. It is required to store SSH keys in the database.',
      );
    }
    return String(s).trim();
  }

  /**
   * When false (default), SSH host / publicIpv4 must be publicly routable to reduce SSRF against the API host and cloud metadata.
   */
  private allowPrivateRemoteSshHosts(): boolean {
    const raw =
      this.configService.get<string>(
        'WEEHAWK_ALLOW_PRIVATE_REMOTE_SSH_HOSTS',
      ) ?? '';
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
  }

  private async enforcePublicRemoteSshTargets(
    host: string,
    publicIpv4: string | null | undefined,
  ): Promise<void> {
    if (this.allowPrivateRemoteSshHosts()) return;
    await assertPublicRemoteSshHost(host);
    const pip = publicIpv4?.trim();
    if (pip) assertPublicRemoteIpv4Literal(pip);
  }

  toSafe(rs: RemoteServer): RemoteServerSafe {
    const hasEnc = !!(rs.privateKeyEncrypted && rs.privateKeyEncrypted.trim());
    const hasPrivateKey = hasEnc;
    const authMode: 'stored' | 'none' = hasEnc ? 'stored' : 'none';
    return {
      id: rs.id,
      publicId: rs.publicId,
      name: rs.name,
      host: rs.host,
      port: rs.port,
      sshUser: rs.sshUser,
      serverRole: rs.serverRole === 'build' ? 'build' : 'deploy',
      authMode,
      hasPrivateKey,
      publicIpv4: rs.publicIpv4?.trim() ? rs.publicIpv4.trim() : null,
      domainsJson: rs.domainsJson?.trim() ? rs.domainsJson.trim() : null,
      sshHostKeySha256: rs.sshHostKeySha256?.trim()
        ? rs.sshHostKeySha256.trim()
        : null,
      createdAt: rs.createdAt,
      updatedAt: rs.updatedAt,
    };
  }

  private buildSshHostVerifier(rs: RemoteServer): (key: Buffer) => boolean {
    const loopback = isLoopbackSshHost(rs.host.trim());
    const expected = rs.sshHostKeySha256?.trim() ?? '';
    return (key: Buffer) => {
      if (loopback) {
        return true;
      }
      const observed = sshHostKeySha256Fingerprint(key);
      if (!expected) {
        this.pendingSshHostKeyByServerId.set(rs.id, observed);
        return true;
      }
      if (!sshHostKeysEqual(expected, observed)) {
        return false;
      }
      this.pendingSshHostKeyByServerId.delete(rs.id);
      return true;
    };
  }

  /**
   * Spread into ssh2 `Client.connect`. After `ready`, call {@link flushPendingSshHostKeyFingerprint}.
   */
  getSsh2ConnectOptions(
    rs: RemoteServer,
    privateKeyPem: string,
    readyTimeoutMs = 120_000,
  ): ConnectConfig {
    const p = this.getSshConnectParams(rs, privateKeyPem);
    return {
      host: p.host,
      port: p.port,
      username: p.username,
      privateKey: p.privateKey,
      readyTimeout: readyTimeoutMs,
      hostVerifier: this.buildSshHostVerifier(rs),
      ...(p.family != null ? { family: p.family } : {}),
    };
  }

  /** Persist trust-on-first-use host key after a successful ssh2 handshake. */
  async flushPendingSshHostKeyFingerprint(
    remoteServerId: number,
  ): Promise<void> {
    const fp = this.pendingSshHostKeyByServerId.get(remoteServerId);
    if (!fp) {
      return;
    }
    const row =
      await this._internal_system_findRemoteServerHostKeyRowByIdOrNull(
        remoteServerId,
      );
    if (!row || (row.sshHostKeySha256?.trim()?.length ?? 0) > 0) {
      this.pendingSshHostKeyByServerId.delete(remoteServerId);
      return;
    }
    await this.remoteServerRepository.update(
      { id: remoteServerId },
      { sshHostKeySha256: fp },
    );
    this.pendingSshHostKeyByServerId.delete(remoteServerId);
  }

  /** Clear in-memory TOFU host-key capture when the session fails before {@link flushPendingSshHostKeyFingerprint}. */
  clearPendingSshHostKeyForServer(remoteServerId: number): void {
    this.pendingSshHostKeyByServerId.delete(remoteServerId);
  }

  /** PEM text for Dockerode / temp file (decrypts DB ciphertext). */
  private async resolvePrivateKeyPem(rs: RemoteServer): Promise<string> {
    if (rs.privateKeyEncrypted?.trim()) {
      try {
        return decryptPrivateKey(
          rs.privateKeyEncrypted,
          this.getEncryptionSecret(),
        );
      } catch {
        throw new BadRequestException(
          'Could not decrypt stored SSH key. Ensure WEEHAWK_ENCRYPTION_KEY matches the value used when the key was saved.',
        );
      }
    }
    throw new BadRequestException(
      'Remote server has no SSH private key configured.',
    );
  }

  /**
   * Filesystem path for `ssh -i` (decrypts DB key to a temp file).
   */
  private async resolveIdentityFilePath(rs: RemoteServer): Promise<string> {
    const pem = await this.resolvePrivateKeyPem(rs);
    const dir = path.join(os.tmpdir(), 'weehawk-ssh-keys');
    await fs.mkdir(dir, { recursive: true });
    const fp = path.join(dir, `server-${rs.id}.key`);
    await fs.writeFile(fp, pem, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(fp, 0o600);
    return fp;
  }

  /**
   * Shared ssh2 connect params for Dockerode and plain SSH checks (loopback → localhost + IPv4).
   */
  private getSshConnectParams(
    rs: RemoteServer,
    privateKeyPem: string,
  ): {
    host: string;
    port: number;
    username: string;
    privateKey: Buffer;
    family?: number;
  } {
    const raw = rs.host.trim();
    const isLoopback = isLoopbackSshHost(raw);
    const host = isLoopback ? 'localhost' : raw;
    const port = rs.port ?? 22;
    return {
      host,
      port,
      username: rs.sshUser.trim(),
      privateKey: Buffer.from(privateKeyPem, 'utf8'),
      ...(isLoopback ? { family: 4 } : {}),
    };
  }

  /**
   * Run `docker` on the remote host over ssh2 (no local `DOCKER_HOST=ssh://…`).
   * Matches remote image build (Dockerode-over-SSH): avoids broken Docker CLI dial-stdio on Windows API hosts.
   */
  async execDockerCliOnRemoteViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    bashScriptBody: string,
    onChunk?: (s: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const script = `set -eu\n${bashScriptBody}`;
    return await this.execSshBashScriptCollectOutput(rs, pem, script, onChunk);
  }

  /**
   * Run `docker …` on the remote host and capture **binary** stdout (for `docker exec` dumps).
   * Stderr is decoded as UTF-8 text for error messages.
   */
  async execDockerArgvBinaryOnRemoteViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    argv: string[],
  ): Promise<{ stdout: Buffer; stderr: string }> {
    if (argv.length === 0) {
      throw new BadRequestException('docker argv is empty');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const cmd = argv.map((a) => shSingleQuoteRemote(String(a))).join(' ');
    const script = `set -euo pipefail\ndocker ${cmd}\n`;
    return await this.withSshClient(rs, pem, (client) =>
      this.execSshBashScriptCollectOutputBinaryStdoutOnClient(client, script),
    );
  }

  /**
   * `docker compose` in the persistent mirror dir ({@link WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/&lt;project&gt;).
   */
  async composeInPersistentDeploymentViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    params: {
      projectName: string;
      /** Arguments after `docker compose -f docker-compose.yml -p &lt;project&gt;` (shell-quoted individually). */
      composeArgvTail: string[];
      deployEnv?: Record<string, string>;
      onChunk?: (s: string) => void;
    },
  ): Promise<{ stdout: string; stderr: string }> {
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(params.projectName)}`;
    const persistQ = shSingleQuoteRemote(persist);
    const projQ = shSingleQuoteRemote(params.projectName);
    const tail = params.composeArgvTail
      .map((a) => shSingleQuoteRemote(String(a)))
      .join(' ');
    const envBlock = bashExportBlockForStackDeploy(params.deployEnv ?? {});
    const script = `set -euo pipefail
${envBlock}
PERSIST=${persistQ}
cd "$PERSIST"
if [ -d "$PERSIST/docker-config" ]; then export DOCKER_CONFIG="$PERSIST/docker-config"; fi
docker compose -f docker-compose.yml -p ${projQ} ${tail}
`;
    return this.execDockerCliOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      script,
      params.onChunk,
    );
  }

  /**
   * Creates a `.tar.gz` of a named volume on the remote host at `${stagingDir}/${archiveBasename}`.
   * Caller should upload or import from this path, then remove `stagingDir` (e.g. {@link removeRemoteTreeBestEffort}).
   */
  async dockerNamedVolumeBackupArchiveOnRemoteToPath(
    remoteServerId: number,
    projectUserId: number | null,
    volumeName: string,
    archiveBasename: string,
  ): Promise<{
    stagingDir: string;
    remoteArchivePath: string;
  }> {
    const safe = volumeName.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(safe)) {
      throw new BadRequestException('Invalid volume name.');
    }
    const base = path.basename(archiveBasename);
    if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/i.test(base)) {
      throw new BadRequestException('Invalid archive name.');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const token = randomBytes(8).toString('hex');
    const stagingDir = `/tmp/weehawk-vol-bk-${token}`;
    const stagingDirQ = shSingleQuoteRemote(stagingDir);
    const volQ = shSingleQuoteRemote(safe);
    const finalFile = `${stagingDir}/${base}`;
    const script = `set -euo pipefail
mkdir -p ${stagingDirQ}
docker run --rm -v ${volQ}:/v:ro -v ${stagingDirQ}:/out alpine:3.19 tar czf /out/backup.tar.gz -C /v .
mv ${shSingleQuoteRemote(`${stagingDir}/backup.tar.gz`)} ${shSingleQuoteRemote(finalFile)}
`;
    await this.withSshClient(rs, pem, async (client) => {
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        script,
        undefined,
      );
    });
    return { stagingDir, remoteArchivePath: finalFile };
  }

  async allocRemoteWeehawkTempDir(
    remoteServerId: number,
    projectUserId: number | null,
    dirNamePrefix: string,
  ): Promise<string> {
    const safePrefix =
      dirNamePrefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'wh';
    const token = randomBytes(8).toString('hex');
    const dir = `/tmp/${safePrefix}-${token}`;
    const dirQ = shSingleQuoteRemote(dir);
    await this.execDockerCliOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      `mkdir -p ${dirQ}\n`,
    );
    return dir;
  }

  async removeRemoteTreeBestEffort(
    remoteServerId: number,
    projectUserId: number | null,
    remotePath: string,
  ): Promise<void> {
    const p = remotePath.trim();
    if (!p.startsWith('/tmp/') || p.includes('..')) {
      return;
    }
    const pQ = shSingleQuoteRemote(p);
    try {
      await this.execDockerCliOnRemoteViaSsh(
        remoteServerId,
        projectUserId,
        `rm -rf ${pQ}\n`,
      );
    } catch {
      /* best effort */
    }
  }

  /**
   * Download bytes from a presigned GET URL on the deploy host (URL is written via SFTP to avoid shell quoting issues).
   */
  async curlPresignedDownloadToRemotePath(
    remoteServerId: number,
    projectUserId: number | null,
    presignedUrl: string,
    remoteDestAbsolutePath: string,
  ): Promise<void> {
    const u = presignedUrl.trim();
    if (!/^https?:\/\//i.test(u)) {
      throw new BadRequestException('Invalid presigned URL.');
    }
    const dest = remoteDestAbsolutePath.trim();
    if (!dest.startsWith('/tmp/') || dest.includes('..')) {
      throw new BadRequestException('Invalid destination path.');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const token = randomBytes(8).toString('hex');
    const urlFile = `/tmp/weehawk-s3get-url-${token}`;
    const urlQ = shSingleQuoteRemote(urlFile);
    const destQ = shSingleQuoteRemote(dest);
    await this.withSshClient(rs, pem, async (client) => {
      await this.sftpWriteRemoteBuffer(client, urlFile, Buffer.from(u, 'utf8'));
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        `set -euo pipefail
U=$(tr -d '\\n\\r' < ${urlQ})
rm -f ${urlQ}
curl -fsSL -o ${destQ} "$U"
`,
        undefined,
      );
    });
  }

  /**
   * PUT a file that already exists on the deploy host to a presigned upload URL (must match signed Content-Type).
   */
  async curlPresignedPutFromRemoteFile(
    remoteServerId: number,
    projectUserId: number | null,
    remoteSourceAbsolutePath: string,
    presignedUrl: string,
    contentType: string,
  ): Promise<void> {
    const u = presignedUrl.trim();
    if (!/^https?:\/\//i.test(u)) {
      throw new BadRequestException('Invalid presigned URL.');
    }
    const src = remoteSourceAbsolutePath.trim();
    if (!src.startsWith('/tmp/') || src.includes('..')) {
      throw new BadRequestException('Invalid source path.');
    }
    const ct = contentType?.trim() || 'application/octet-stream';
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const token = randomBytes(8).toString('hex');
    const urlFile = `/tmp/weehawk-s3put-url-${token}`;
    const urlQ = shSingleQuoteRemote(urlFile);
    const srcQ = shSingleQuoteRemote(src);
    const ctQ = shSingleQuoteRemote(ct);
    await this.withSshClient(rs, pem, async (client) => {
      await this.sftpWriteRemoteBuffer(client, urlFile, Buffer.from(u, 'utf8'));
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        `set -euo pipefail
U=$(tr -d '\\n\\r' < ${urlQ})
rm -f ${urlQ}
curl -fsS -X PUT -T ${srcQ} -H ${ctQ} "$U"
`,
        undefined,
      );
    });
  }

  /**
   * Stream bytes into a new file under `/tmp/...` on the deploy host (SFTP write stream).
   * Used so multipart imports never land on the API filesystem.
   */
  async pipeUploadStreamToRemoteImport(
    remoteServerId: number,
    projectUserId: number | null,
    safeBasename: string,
    body: Readable,
  ): Promise<{ stagingDir: string; remotePath: string }> {
    if (!/^[a-zA-Z0-9._-]+$/.test(safeBasename)) {
      throw new BadRequestException('Invalid file name.');
    }
    if (safeBasename.length > 255) {
      throw new BadRequestException('File name is too long.');
    }
    const stagingDir = await this.allocRemoteWeehawkTempDir(
      remoteServerId,
      projectUserId,
      'wh-import-mp',
    );
    const remotePath = `${stagingDir}/${safeBasename}`;
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    try {
      await this.withSshClient(rs, pem, async (client) => {
        await new Promise<void>((resolve, reject) => {
          client.sftp((sftpErr, sftp) => {
            if (sftpErr) {
              reject(sftpErr);
              return;
            }
            const ws = sftp.createWriteStream(remotePath);
            const done = (e?: Error) => {
              try {
                sftp.end();
              } catch {
                /* ignore */
              }
              if (e) {
                reject(e);
              } else {
                resolve();
              }
            };
            ws.on('error', (e) =>
              done(e instanceof Error ? e : new Error(String(e))),
            );
            pipeline(body, ws)
              .then(() => done())
              .catch((e) =>
                done(e instanceof Error ? e : new Error(String(e))),
              );
          });
        });
      });
    } catch (e) {
      await this.removeRemoteTreeBestEffort(
        remoteServerId,
        projectUserId,
        stagingDir,
      );
      throw e;
    }
    return { stagingDir, remotePath };
  }

  /**
   * Extract an existing `.tar.gz` on the remote host into a named volume, then delete the archive file.
   */
  async dockerNamedVolumeImportArchiveFromRemotePath(
    remoteServerId: number,
    projectUserId: number | null,
    volumeName: string,
    remoteArchiveAbsolutePath: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const safe = volumeName.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(safe)) {
      throw new BadRequestException('Invalid volume name.');
    }
    const p = remoteArchiveAbsolutePath.trim();
    if (!p.startsWith('/tmp/') || p.includes('..')) {
      throw new BadRequestException('Invalid archive path.');
    }
    const base = path.basename(p);
    if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/i.test(base)) {
      throw new BadRequestException('Expected a .tar.gz archive.');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const inDir = path.posix.dirname(p);
    const inDirQ = shSingleQuoteRemote(inDir);
    const volQ = shSingleQuoteRemote(safe);
    const pQ = shSingleQuoteRemote(p);
    const run = `set -euo pipefail
docker run --rm -v ${volQ}:/v -v ${inDirQ}:/in:ro alpine:3.19 sh -c 'cd /v && tar xzf /in/${base}'
rm -f ${pQ}
`;
    return await this.withSshClient(rs, pem, async (client) => {
      return await this.execSshBashScriptCollectOutputOnClient(
        client,
        run,
        undefined,
      );
    });
  }

  /** `docker cp` from a path on the deploy host into a container (no API-side file read). */
  async dockerCpRemoteHostFileToContainer(
    remoteServerId: number,
    projectUserId: number | null,
    remoteAbsolutePath: string,
    containerId: string,
    pathInContainer: string,
  ): Promise<void> {
    const p = remoteAbsolutePath.trim();
    if (!p.startsWith('/tmp/') || p.includes('..')) {
      throw new BadRequestException('Invalid source path.');
    }
    const base = path.basename(p);
    if (!/^[a-zA-Z0-9._-]+$/.test(base)) {
      throw new BadRequestException('Invalid import file name.');
    }
    const destArg = JSON.stringify(`${containerId}:${pathInContainer}`);
    const srcQ = shSingleQuoteRemote(p);
    await this.execDockerCliOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      `docker cp ${srcQ} ${destArg}\n`,
    );
  }

  /**
   * Reads a file from the API host, uploads it to the deploy host, then `docker cp` into a container there.
   */
  async uploadHostFileAndDockerCpToContainer(
    remoteServerId: number,
    projectUserId: number | null,
    localAbsolutePath: string,
    containerId: string,
    pathInContainer: string,
  ): Promise<void> {
    const buf = await fs.readFile(path.resolve(localAbsolutePath));
    const base = path.basename(localAbsolutePath);
    if (!/^[a-zA-Z0-9._-]+$/.test(base)) {
      throw new BadRequestException('Invalid import file name.');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const token = randomBytes(8).toString('hex');
    const remoteDir = `/tmp/weehawk-dtcp-${token}`;
    const remoteDirQ = shSingleQuoteRemote(remoteDir);
    const remoteFile = `${remoteDir}/${base}`;
    const destArg = JSON.stringify(`${containerId}:${pathInContainer}`);
    await this.withSshClient(rs, pem, async (client) => {
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        `set -euo pipefail\nmkdir -p ${remoteDirQ}\n`,
        undefined,
      );
      await this.sftpWriteRemoteBuffer(client, remoteFile, buf);
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        `set -euo pipefail\ndocker cp ${shSingleQuoteRemote(remoteFile)} ${destArg}\nrm -rf ${remoteDirQ}\n`,
        undefined,
      );
    });
  }

  /**
   * Uploads a local `.tar.gz` and extracts it into a named volume on the remote host.
   */
  async dockerNamedVolumeImportArchiveOnRemote(
    remoteServerId: number,
    projectUserId: number | null,
    volumeName: string,
    archiveBytes: Buffer,
    archiveBasename: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const safe = volumeName.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(safe)) {
      throw new BadRequestException('Invalid volume name.');
    }
    const base = path.basename(archiveBasename);
    if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/i.test(base)) {
      throw new BadRequestException('Expected a .tar.gz archive.');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const token = randomBytes(8).toString('hex');
    const inDir = `/tmp/weehawk-vol-im-${token}`;
    const inDirQ = shSingleQuoteRemote(inDir);
    const remoteFile = `${inDir}/${base}`;
    const volQ = shSingleQuoteRemote(safe);
    return await this.withSshClient(rs, pem, async (client) => {
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        `set -euo pipefail\nmkdir -p ${inDirQ}\n`,
        undefined,
      );
      await this.sftpWriteRemoteBuffer(client, remoteFile, archiveBytes);
      const run = `set -euo pipefail
docker run --rm -v ${volQ}:/v -v ${inDirQ}:/in:ro alpine:3.19 sh -c 'cd /v && tar xzf /in/${base}'
rm -rf ${inDirQ}
`;
      return await this.execSshBashScriptCollectOutputOnClient(
        client,
        run,
        undefined,
      );
    });
  }

  /**
   * Detach a Swarm secret from all services on the remote manager, then remove it (same goal as local {@link DockerSecretsService.removePrune}).
   */
  async dockerSecretRemovePruneViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    secretName: string,
  ): Promise<void> {
    const name = secretName.trim();
    if (!name) {
      return;
    }
    const inspectId = await this.execDockerCliOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      `docker secret inspect ${JSON.stringify(name)} --format '{{.ID}}' 2>/dev/null || true`,
    );
    const secretId = inspectId.stdout.trim();
    if (!secretId) {
      return;
    }

    const detach = async () => {
      const listSvc = await this.execDockerCliOnRemoteViaSsh(
        remoteServerId,
        projectUserId,
        `docker service ls -q 2>/dev/null || true`,
      );
      const serviceIds = listSvc.stdout
        .trim()
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const serviceId of serviceIds) {
        try {
          const inspectOut = await this.execDockerCliOnRemoteViaSsh(
            remoteServerId,
            projectUserId,
            `docker service inspect ${JSON.stringify(serviceId)}`,
          );
          const parsed = JSON.parse(inspectOut.stdout) as Array<{
            Spec?: {
              TaskTemplate?: {
                ContainerSpec?: {
                  Secrets?: Array<{
                    SecretID?: string;
                    SecretName?: string;
                    File?: { Name?: string };
                  }>;
                };
              };
            };
          }>;
          const item = Array.isArray(parsed) ? parsed[0] : undefined;
          const secrets =
            item?.Spec?.TaskTemplate?.ContainerSpec?.Secrets ?? [];
          const matched = secrets.find((s) => {
            if (secretId && s?.SecretID === secretId) return true;
            if (s?.SecretName === name) return true;
            if (s?.File?.Name === name) return true;
            return false;
          });
          if (!matched) continue;
          const rmCandidates = Array.from(
            new Set(
              [name, matched?.SecretName, matched?.File?.Name]
                .map((v) => (v ?? '').trim())
                .filter(Boolean),
            ),
          );
          for (const rm of rmCandidates) {
            try {
              await this.execDockerCliOnRemoteViaSsh(
                remoteServerId,
                projectUserId,
                `docker service update --secret-rm ${JSON.stringify(rm)} ${JSON.stringify(serviceId)}`,
              );
              break;
            } catch {
              /* try next */
            }
          }
        } catch {
          /* best effort */
        }
      }
    };

    await detach();
    await new Promise((r) => setTimeout(r, 800));

    let lastErr = '';
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        await this.execDockerCliOnRemoteViaSsh(
          remoteServerId,
          projectUserId,
          `docker secret rm ${JSON.stringify(name)}`,
        );
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastErr = msg;
        if (/in use|being used|currently in use/i.test(msg) && attempt < 6) {
          if (attempt === 1) {
            await detach();
          }
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        this.logger.error(
          `Remote docker secret remove failed (server #${remoteServerId}, secret="${name}").`,
          e instanceof Error ? e.stack : String(e),
        );
        throw new InternalServerErrorException(
          'Docker operation failed on remote host',
        );
      }
    }
    this.logger.error(
      `Remote docker secret remove retries exhausted (server #${remoteServerId}, secret="${name}")`,
      lastErr,
    );
    throw new InternalServerErrorException(
      'Docker operation failed on remote host',
    );
  }

  /**
   * Stream `docker … logs -f` on the deploy host until {@link cancel} or remote disconnect.
   * Used for service live logs when the API runs on a machine without local Docker (e.g. Windows).
   */
  async streamDockerLogsFollowOnRemoteViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    bashScriptBody: string,
    onChunk: (s: string) => void,
    onRemoteEnd?: (exitCode: number | null) => void,
  ): Promise<{ cancel: () => void }> {
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const connectOpts = this.getSsh2ConnectOptions(rs, pem, 120_000);
    const script = `set +e\n${bashScriptBody}\n`;

    return await new Promise((resolveOuter, rejectOuter) => {
      const client = new Client();
      let streamRef: ClientChannel | null = null;
      let settled = false;

      const cancel = () => {
        try {
          streamRef?.close();
        } catch {
          /* ignore */
        }
        try {
          client.end();
        } catch {
          /* ignore */
        }
      };

      client
        .once('ready', () => {
          void this.flushPendingSshHostKeyFingerprint(rs.id).then(() => {
            client.exec('bash -s', (err, stream) => {
              if (err || !stream) {
                if (!settled) {
                  settled = true;
                  rejectOuter(
                    err ??
                      new InternalServerErrorException(
                        'SSH exec failed for remote docker logs',
                      ),
                  );
                }
                try {
                  client.end();
                } catch {
                  /* ignore */
                }
                return;
              }
              streamRef = stream;
              stream.on('data', (d: Buffer) => onChunk(d.toString()));
              stream.stderr.on('data', (d: Buffer) => onChunk(d.toString()));
              stream.on('close', (code: number | null) => {
                onRemoteEnd?.(code ?? null);
                try {
                  client.end();
                } catch {
                  /* ignore */
                }
              });
              stream.write(script);
              stream.end();
              if (!settled) {
                settled = true;
                resolveOuter({ cancel });
              }
            });
          });
        })
        .on('error', (err: Error) => {
          this.clearPendingSshHostKeyForServer(rs.id);
          if (!settled) {
            settled = true;
            rejectOuter(err);
          }
        })
        .connect(connectOpts);
    });
  }

  /**
   * Public URL for the on-host webhook agent (e.g. Go) that runs
   * `{@link WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/{token}.sh`.
   * Env: `WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT` (default 8759),
   * `WEEHAWK_REMOTE_WEBHOOK_URL_PATH_PREFIX` (default `weehawk-hooks` → path `/weehawk-hooks/{token}`).
   * Webhook trigger URLs always use HTTPS.
   */
  /** HTTP port the on-host webhook agent must listen on (loopback health check + systemd unit). */
  resolveRemoteWebhookHttpPort(): number {
    const portRaw = this.configService.get<string>(
      'WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT',
    );
    const portNum =
      portRaw != null && String(portRaw).trim() !== '' ? Number(portRaw) : 8759;
    return Number.isFinite(portNum) && portNum > 0 ? portNum : 8759;
  }

  /** URL path segment before the secret token (must match weehawk-webhook-agent). */
  resolveRemoteWebhookPathPrefix(): string {
    const pathPrefix =
      this.configService
        .get<string>('WEEHAWK_REMOTE_WEBHOOK_URL_PATH_PREFIX')
        ?.trim() || 'weehawk-hooks';
    return pathPrefix.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Traefik entrypoints for the webhook Swarm service (comma-separated).
   * Default `web,websecure` matches deploy provision (:80 and :443).
   * The Swarm recreate emits **one Traefik router per entrypoint** so plain HTTP on `web` is not
   * forced to TLS (a single router with `entrypoints=web,websecure` and `tls=true` can redirect HTTP→HTTPS).
   */
  private resolveWeehawkWebhookAgentTraefikEntrypoints(): string {
    const raw = this.configService
      .get<string>('WEEHAWK_WEBHOOK_AGENT_TRAEFIK_ENTRYPOINTS')
      ?.trim();
    if (raw) {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(',');
    }
    return 'web,websecure';
  }

  formatRemoteWebhookHttpTriggerUrlFromSafe(
    rs: Pick<RemoteServerSafe, 'host' | 'publicIpv4'>,
    secretToken: string,
    scheme: 'http' | 'https',
  ): string {
    const port = this.resolveRemoteWebhookHttpPort();
    const pathPrefix = this.resolveRemoteWebhookPathPrefix();
    const hostRaw = rs.publicIpv4?.trim() || rs.host.trim();
    const host =
      hostRaw.includes(':') && !hostRaw.startsWith('[')
        ? `[${hostRaw}]`
        : hostRaw;
    const defaultPort = scheme === 'https' ? 443 : 80;
    const portPart = port === defaultPort ? '' : `:${port}`;
    const pathSuffix = `/${pathPrefix}/${secretToken}`.replace(/\/+/g, '/');
    return `${scheme}://${host}${portPart}${pathSuffix}`;
  }

  /**
   * When set, the API deploys the `weehawk-webhook-agent` Swarm service
   * (Docker image with Traefik labels) instead of installing a systemd binary on the host.
   */
  getWeehawkWebhookAgentImage(): string | null {
    return (
      this.configService.get<string>('WEEHAWK_WEBHOOK_AGENT_IMAGE')?.trim() ||
      null
    );
  }

  /**
   * Embed in the deploy-host Install script: registry pull or bundled Dockerfile/main.go/go.mod build.
   */
  async getWebhookAgentProvisionInput(): Promise<WebhookAgentProvisionInput> {
    const registry = this.getWeehawkWebhookAgentImage();
    if (registry) {
      return { mode: 'registry', image: registry };
    }
    const dir = await this.resolveBundledWebhookAgentDir();
    if (!dir) {
      return { mode: 'none' };
    }
    try {
      const dockerfile = await fs.readFile(path.join(dir, 'Dockerfile'));
      const mainGo = await fs.readFile(path.join(dir, 'main.go'));
      const goMod = await fs.readFile(path.join(dir, 'go.mod'));
      return {
        mode: 'bundle',
        imageTag: WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE,
        dockerfileB64: dockerfile.toString('base64'),
        mainGoB64: mainGo.toString('base64'),
        goModB64: goMod.toString('base64'),
      };
    } catch {
      return { mode: 'none' };
    }
  }

  /**
   * Public trigger URL when the webhook uses a dedicated hostname behind Traefik on the deploy host.
   */
  formatRemoteWebhookTriggerUrlFromPublicHost(
    publicHost: string,
    secretToken: string,
    scheme: 'http' | 'https',
  ): string {
    const pathPrefix = this.resolveRemoteWebhookPathPrefix();
    const pathSuffix = `/${pathPrefix}/${secretToken}`.replace(/\/+/g, '/');
    const host = publicHost.trim().toLowerCase();
    return `${scheme}://${host}${pathSuffix}`;
  }

  /**
   * Ensures the webhook agent is running:
   * - Swarm + registry image when {@code WEEHAWK_WEBHOOK_AGENT_IMAGE} is set
   * - Swarm + image built on the host from bundled Dockerfile/source when any {@code hooksPublicHost} is used
   * - If deploy-host Install already created Swarm service {@code weehawk-webhook-agent}, no-op
   * - Otherwise legacy systemd + on-host Go binary
   */
  async ensureRemoteWebhookListening(
    remoteServerId: number,
    projectUserId: number | null,
    hooksPublicHosts: string[],
  ): Promise<void> {
    const registryImage = this.getWeehawkWebhookAgentImage();
    const hasPublicHosts =
      normalizeHooksPublicHosts(hooksPublicHosts).length > 0;

    if (registryImage) {
      await this.recreateWeehawkWebhookSwarmService(
        remoteServerId,
        projectUserId,
        registryImage,
        hooksPublicHosts,
        { pullImage: true },
      );
      return;
    }

    if (hasPublicHosts) {
      const image = await this.buildBundledWebhookAgentImageOnRemote(
        remoteServerId,
        projectUserId,
      );
      await this.recreateWeehawkWebhookSwarmService(
        remoteServerId,
        projectUserId,
        image,
        hooksPublicHosts,
        { pullImage: false },
      );
      return;
    }

    if (
      await this.remoteSwarmWebhookAgentServiceExists(
        remoteServerId,
        projectUserId,
      )
    ) {
      return;
    }

    await this.ensureRemoteWebhookAgent(remoteServerId, projectUserId);
  }

  private async remoteSwarmWebhookAgentServiceExists(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<boolean> {
    const q = shSingleQuoteRemote(WEEHAWK_WEBHOOK_SWARM_SERVICE_NAME);
    const body = `docker service inspect ${q} >/dev/null 2>&1`;
    try {
      await this.execDockerCliOnRemoteViaSsh(
        remoteServerId,
        projectUserId,
        body,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async recreateWeehawkWebhookSwarmService(
    remoteServerId: number,
    projectUserId: number | null,
    image: string,
    hooksPublicHosts: string[],
    options?: { pullImage?: boolean },
  ): Promise<void> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.runWebhookSwarmOpSerialized(remoteServerId, () =>
          this.recreateWeehawkWebhookSwarmServiceUnlocked(
            remoteServerId,
            projectUserId,
            image,
            hooksPublicHosts,
            options,
          ),
        );
        return;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const retryable =
          msg.includes('Docker Swarm is not active') ||
          msg.includes('Cannot connect to the Docker daemon') ||
          msg.includes('context deadline exceeded');
        if (!retryable || attempt >= maxAttempts) {
          throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async recreateWeehawkWebhookSwarmServiceUnlocked(
    remoteServerId: number,
    projectUserId: number | null,
    image: string,
    hooksPublicHosts: string[],
    options?: { pullImage?: boolean },
  ): Promise<void> {
    const pullImage = options?.pullImage ?? true;
    const net = WEEHAWK_TRAEFIK_EXTERNAL_NETWORK.trim() || 'weehawk';
    const svc = WEEHAWK_WEBHOOK_SWARM_SERVICE_NAME;
    const scriptsDir = WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR;
    const port = this.resolveRemoteWebhookHttpPort();
    const pathPrefix = this.resolveRemoteWebhookPathPrefix();
    const hostsNorm = normalizeHooksPublicHosts(hooksPublicHosts);
    const rule = buildTraefikHostRuleForWebhookAgent(hostsNorm, pathPrefix);
    const entrypointsCsv = this.resolveWeehawkWebhookAgentTraefikEntrypoints();
    const entrypointsList = entrypointsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const imageQ = shSingleQuoteRemote(image);
    /** Scripts uploaded by the API (token.sh). */
    const mountScripts = `type=bind,source=${scriptsDir},target=${scriptsDir}`;
    /**
     * On-host redeploy bash must read docker-compose.yml under {@link WEEHAWK_REMOTE_DEPLOYMENTS_BASE}.
     * Without this mount the agent container only saw an empty path while the host had the mirror.
     */
    const mountDeployments = `type=bind,source=${WEEHAWK_REMOTE_DEPLOYMENTS_BASE},target=${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}`;
    /** Bash redeploy scripts invoke `docker`; the agent image is client-only and talks to the host daemon. */
    const mountDockerSock =
      'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock';

    const serverRow = await this.remoteServerRepository.findOne({
      where: { id: remoteServerId },
    });
    if (!serverRow) {
      throw new InternalServerErrorException(
        'Remote server not found for webhook agent provisioning.',
      );
    }
    const traefikSettings =
      rule &&
      serverRow.organizationId != null &&
      serverRow.organizationId >= 1
        ? await this.traefikService.getSettingsForOrganization(
            await this.traefikService.resolveOrganizationInternalIdForTraefik(
              serverRow.organizationId,
              0,
            ),
          )
        : null;
    const certResolverName = (
      traefikSettings?.certResolverName || 'letsencrypt'
    ).trim();

    const labelsPart = rule
      ? (() => {
          const base = [
            `--label ${shSingleQuoteRemote('traefik.enable=true')}`,
            `--label ${shSingleQuoteRemote(`traefik.docker.network=${net}`)}`,
            `--label ${shSingleQuoteRemote(`traefik.http.services.weehawkhooks.loadbalancer.server.port=${port}`)}`,
            `--label ${shSingleQuoteRemote('traefik.http.services.weehawkhooks.loadbalancer.passhostheader=true')}`,
          ];
          const routerLabels: string[] = [];
          for (const ep of entrypointsList.length
            ? entrypointsList
            : ['web', 'websecure']) {
            const safe = ep.replace(/[^a-z0-9-]/gi, '') || 'ep';
            const routerName = `weehawkhooks-${safe}`;
            routerLabels.push(
              `--label ${shSingleQuoteRemote(`traefik.http.routers.${routerName}.rule=${rule}`)}`,
              `--label ${shSingleQuoteRemote(`traefik.http.routers.${routerName}.entrypoints=${ep}`)}`,
              `--label ${shSingleQuoteRemote(`traefik.http.routers.${routerName}.service=weehawkhooks`)}`,
            );
            if (ep === 'websecure') {
              routerLabels.push(
                `--label ${shSingleQuoteRemote(`traefik.http.routers.${routerName}.tls=true`)}`,
                `--label ${shSingleQuoteRemote(`traefik.http.routers.${routerName}.tls.certresolver=${certResolverName}`)}`,
              );
            }
          }
          return [...base, ...routerLabels].join(' ');
        })()
      : `--publish mode=host,published=${port},target=${port}`;

    const dockerCreateOneLine = [
      'docker service create',
      '--name "$SVC"',
      '--network "$NET"',
      '--constraint node.role==manager',
      `--mount ${shSingleQuoteRemote(mountScripts)}`,
      `--mount ${shSingleQuoteRemote(mountDeployments)}`,
      `--mount ${shSingleQuoteRemote(mountDockerSock)}`,
      `-e WEEHAWK_HOOK_LISTEN=:${port}`,
      '-e WEEHAWK_HOOK_SCRIPTS_DIR="$SCRIPTS"',
      '-e WEEHAWK_HOOK_PATH_PREFIX="$PFIX"',
      labelsPart,
      '"$IMAGE"',
    ].join(' ');

    const body = [
      'set -euo pipefail',
      `IMAGE=${imageQ}`,
      `NET=${shSingleQuoteRemote(net)}`,
      `SVC=${shSingleQuoteRemote(svc)}`,
      `SCRIPTS=${shSingleQuoteRemote(scriptsDir)}`,
      `DEPLOY=${shSingleQuoteRemote(WEEHAWK_REMOTE_DEPLOYMENTS_BASE)}`,
      `PFIX=${shSingleQuoteRemote(pathPrefix)}`,
      'if ! command -v docker >/dev/null 2>&1; then echo "docker CLI not found on remote host" >&2; exit 1; fi',
      'if ! docker info 2>/dev/null | grep -q "Swarm: active"; then echo "Docker Swarm is not active. Run Weehawk deploy-server provision on this host first (Swarm + weehawk overlay network)." >&2; exit 1; fi',
      'sudo -n mkdir -p "$SCRIPTS" 2>/dev/null || sudo mkdir -p "$SCRIPTS"',
      'sudo -n mkdir -p "$DEPLOY" 2>/dev/null || sudo mkdir -p "$DEPLOY"',
      'sudo -n systemctl stop weehawk-webhook-agent 2>/dev/null || true',
      'sudo -n systemctl disable weehawk-webhook-agent 2>/dev/null || true',
      ...(pullImage ? ['docker pull "$IMAGE" || true'] : []),
      'if docker service inspect "$SVC" >/dev/null 2>&1; then docker service rm "$SVC"; fi',
      '_wh_i=0',
      'while docker service inspect "$SVC" >/dev/null 2>&1; do',
      '  _wh_i=$((_wh_i+1))',
      '  if [ "$_wh_i" -gt 45 ]; then echo "timeout waiting for docker service removal: $SVC" >&2; exit 1; fi',
      '  sleep 1',
      'done',
      dockerCreateOneLine,
    ].join('\n');

    await this.execDockerCliOnRemoteViaSsh(remoteServerId, projectUserId, body);
  }

  /**
   * Builds {@link WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE} on the remote manager via `docker build`
   * from API-bundled Dockerfile + Go source (no registry).
   */
  private async remoteDockerImageExistsOnRemote(
    remoteServerId: number,
    projectUserId: number | null,
    imageRef: string,
  ): Promise<boolean> {
    const q = shSingleQuoteRemote(imageRef);
    const body = `docker image inspect ${q} >/dev/null 2>&1`;
    try {
      await this.execDockerCliOnRemoteViaSsh(
        remoteServerId,
        projectUserId,
        body,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async buildBundledWebhookAgentImageOnRemote(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<string> {
    if (
      await this.remoteDockerImageExistsOnRemote(
        remoteServerId,
        projectUserId,
        WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE,
      )
    ) {
      return WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE;
    }
    const bundleDir = await this.resolveBundledWebhookAgentDir();
    if (!bundleDir) {
      throw new BadRequestException(
        'Weehawk webhook agent bundle (main.go, go.mod, Dockerfile) was not found in this API build. ' +
          'Set WEEHAWK_WEBHOOK_AGENT_IMAGE to a registry image you can pull on the deploy host.',
      );
    }
    let dockerfile: Buffer;
    let mainGo: Buffer;
    let goMod: Buffer;
    try {
      dockerfile = await fs.readFile(path.join(bundleDir, 'Dockerfile'));
      mainGo = await fs.readFile(path.join(bundleDir, 'main.go'));
      goMod = await fs.readFile(path.join(bundleDir, 'go.mod'));
    } catch {
      throw new BadRequestException(
        'Could not read bundled webhook agent files for Docker build. Set WEEHAWK_WEBHOOK_AGENT_IMAGE instead.',
      );
    }

    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const remoteDir = `/tmp/weehawk_wa_img_${randomBytes(12).toString('hex')}`;
    const dirQ = remoteDir.replace(/'/g, `'\\''`);
    const tag = WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE;
    const tagQ = tag.replace(/'/g, `'\\''`);

    const body = `set -euo pipefail
DIR='${dirQ}'
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"
docker build -t '${tagQ}' .
`;

    await this.withSshClient(rs, pem, async (client) => {
      await this.sshExecCollectOutput(client, `mkdir -p '${dirQ}'`);
      await this.sftpWriteRemoteBuffer(
        client,
        `${remoteDir}/Dockerfile`,
        dockerfile,
      );
      await this.sftpWriteRemoteBuffer(client, `${remoteDir}/main.go`, mainGo);
      await this.sftpWriteRemoteBuffer(client, `${remoteDir}/go.mod`, goMod);
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        body,
        undefined,
      );
    });

    return tag;
  }

  /**
   * True when loopback `http://127.0.0.1:{port}/{pathPrefix}/healthz` responds (weehawk-webhook-agent).
   */
  async isRemoteWebhookAgentHealthy(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<boolean> {
    const port = this.resolveRemoteWebhookHttpPort();
    const pathPrefix = this.resolveRemoteWebhookPathPrefix();
    const healthPath = `/${pathPrefix}/healthz`.replace(/\/+/g, '/');
    const body = `
if command -v curl >/dev/null 2>&1; then
  curl -sf --max-time 6 "http://127.0.0.1:${port}${healthPath}" >/dev/null
  exit 0
fi
if command -v wget >/dev/null 2>&1; then
  wget -q -T 6 -O /dev/null "http://127.0.0.1:${port}${healthPath}"
  exit 0
fi
exit 1
`;
    try {
      await this.execDockerCliOnRemoteViaSsh(
        remoteServerId,
        projectUserId,
        body,
      );
      return true;
    } catch {
      return false;
    }
  }

  private buildWebhookAgentSystemdUnit(): string {
    const port = this.resolveRemoteWebhookHttpPort();
    const scriptsDir = WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR;
    const pathPrefix = this.resolveRemoteWebhookPathPrefix();
    return `[Unit]
Description=Weehawk webhook agent
After=network.target

[Service]
Type=simple
Environment=WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT=${port}
Environment=WEEHAWK_HOOK_SCRIPTS_DIR=${scriptsDir}
Environment=WEEHAWK_HOOK_PATH_PREFIX=${pathPrefix}
ExecStart=/usr/local/bin/weehawk-webhook-agent
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
  }

  /**
   * Go source shipped inside the API (`bundled/` + nest assets, or monorepo `packages/` in dev).
   */
  private async resolveBundledWebhookAgentDir(): Promise<string | null> {
    const candidates = [
      path.join(__dirname, '..', 'bundled', 'weehawk-webhook-agent'),
      path.join(__dirname, '..', '..', 'bundled', 'weehawk-webhook-agent'),
      path.join(process.cwd(), 'dist', 'bundled', 'weehawk-webhook-agent'),
      path.join(process.cwd(), 'bundled', 'weehawk-webhook-agent'),
      path.join(process.cwd(), '..', '..', 'packages', 'weehawk-webhook-agent'),
    ];
    for (const dir of candidates) {
      try {
        await fs.access(path.join(dir, 'main.go'));
        await fs.access(path.join(dir, 'go.mod'));
        return dir;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  /**
   * Go toolchain tarball version from {@code https://go.dev/dl/} when auto-install runs on the remote host.
   * Override with {@code WEEHAWK_REMOTE_GO_INSTALL_VERSION} (e.g. {@code 1.22.12}).
   */
  private resolveRemoteGoBootstrapVersion(): string {
    const v = this.configService
      .get<string>('WEEHAWK_REMOTE_GO_INSTALL_VERSION')
      ?.trim();
    if (v && /^\d+\.\d+(\.\d+)?$/.test(v)) {
      return v;
    }
    return '1.22.12';
  }

  /**
   * When false, the remote must already have Go 1.22+. Env: {@code WEEHAWK_REMOTE_GO_AUTO_INSTALL}
   * (set to {@code false}, {@code 0}, or {@code no} to disable).
   */
  private remoteGoAutoInstallEnabled(): boolean {
    const s = this.configService
      .get<string>('WEEHAWK_REMOTE_GO_AUTO_INSTALL')
      ?.trim()
      .toLowerCase();
    return s !== 'false' && s !== '0' && s !== 'no';
  }

  /**
   * Bash snippet: ensure {@code go} is 1.22+ — may download Go to {@code /usr/local/go} (needs {@code sudo -n}).
   */
  private bashEnsureGoToolchainForWebhookBuild(): string {
    const ver = this.resolveRemoteGoBootstrapVersion().replace(/[^0-9.]/g, '');
    if (!this.remoteGoAutoInstallEnabled()) {
      return [
        'if ! command -v go >/dev/null 2>&1; then',
        "  echo 'Go 1.22+ is required (enable automatic install: leave WEEHAWK_REMOTE_GO_AUTO_INSTALL unset, or install Go manually).' >&2",
        '  exit 1',
        'fi',
        "gv=$(go version | sed -n 's/.*go\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2/p')",
        'read major minor <<< "$gv"',
        'if [ "${major:-0}" -lt 1 ] || { [ "${major:-0}" -eq 1 ] && [ "${minor:-0}" -lt 22 ]; }; then',
        "  echo 'Go 1.22+ is required on this server.' >&2",
        '  exit 1',
        'fi',
      ].join('\n');
    }

    return [
      `GO_BOOTSTRAP_VER='${ver}'`,
      'NEED_GO=1',
      'if command -v go >/dev/null 2>&1; then',
      "  gv=$(go version | sed -n 's/.*go\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2/p')",
      '  read major minor <<< "$gv"',
      '  if [ "${major:-0}" -gt 1 ] || { [ "${major:-0}" -eq 1 ] && [ "${minor:-0}" -ge 22 ]; }; then',
      '    NEED_GO=0',
      '  fi',
      'fi',
      'if [ "$NEED_GO" -eq 1 ]; then',
      '  ARCH=$(uname -m)',
      '  case "$ARCH" in',
      '    x86_64) GARCH=amd64 ;;',
      '    aarch64|arm64) GARCH=arm64 ;;',
      '    *)',
      '      echo "Unsupported machine for Go bootstrap: $ARCH (need x86_64 or aarch64/arm64)" >&2',
      '      exit 1',
      '      ;;',
      '  esac',
      '  GO_TGZ="go${GO_BOOTSTRAP_VER}.linux-${GARCH}.tar.gz"',
      '  URL="https://go.dev/dl/${GO_TGZ}"',
      '  TMPG=$(mktemp)',
      '  if command -v curl >/dev/null 2>&1; then',
      '    curl -fsSL "$URL" -o "$TMPG"',
      '  elif command -v wget >/dev/null 2>&1; then',
      '    wget -q "$URL" -O "$TMPG"',
      '  else',
      "    echo 'curl or wget is required to download Go' >&2",
      '    exit 1',
      '  fi',
      '  sudo -n rm -rf /usr/local/go',
      '  sudo -n tar -C /usr/local -xzf "$TMPG"',
      '  rm -f "$TMPG"',
      '  export PATH="/usr/local/go/bin:$PATH"',
      '  hash -r',
      'fi',
    ].join('\n');
  }

  /**
   * Ensures weehawk-webhook-agent is running on the remote host (health check on 127.0.0.1).
   * Install order: (1) push bundled Go source and {@code go build} on the server, (2) optional
   * {@code WEEHAWK_WEBHOOK_AGENT_DOWNLOAD_URL}, (3) optional {@code WEEHAWK_WEBHOOK_AGENT_BINARY} on the API host.
   * Go 1.22+ is installed under {@code /usr/local/go} from go.dev when missing unless
   * {@code WEEHAWK_REMOTE_GO_AUTO_INSTALL} is disabled.
   * Requires passwordless `sudo` on the remote SSH user for install/systemctl.
   */
  async ensureRemoteWebhookAgent(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<void> {
    if (await this.isRemoteWebhookAgentHealthy(remoteServerId, projectUserId)) {
      return;
    }

    const unit = this.buildWebhookAgentSystemdUnit();
    const unitB64 = Buffer.from(unit, 'utf8').toString('base64');
    const downloadUrl = this.configService
      .get<string>('WEEHAWK_WEBHOOK_AGENT_DOWNLOAD_URL')
      ?.trim();
    const localBinary = this.configService
      .get<string>('WEEHAWK_WEBHOOK_AGENT_BINARY')
      ?.trim();
    let lastErr: string | undefined;

    const bundleDir = await this.resolveBundledWebhookAgentDir();
    if (bundleDir) {
      try {
        await this.installRemoteWebhookAgentFromGoSource(
          remoteServerId,
          projectUserId,
          bundleDir,
          unitB64,
        );
        if (
          await this.isRemoteWebhookAgentHealthy(remoteServerId, projectUserId)
        ) {
          return;
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }

    if (downloadUrl) {
      try {
        await this.installRemoteWebhookAgentFromUrl(
          remoteServerId,
          projectUserId,
          downloadUrl,
          unitB64,
        );
        if (
          await this.isRemoteWebhookAgentHealthy(remoteServerId, projectUserId)
        ) {
          return;
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }

    if (localBinary) {
      try {
        await this.installRemoteWebhookAgentFromLocalBinary(
          remoteServerId,
          projectUserId,
          localBinary,
          unitB64,
        );
        if (
          await this.isRemoteWebhookAgentHealthy(remoteServerId, projectUserId)
        ) {
          return;
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }

    const port = this.resolveRemoteWebhookHttpPort();
    const pathPrefix = this.resolveRemoteWebhookPathPrefix();
    const healthPath = `/${pathPrefix}/healthz`.replace(/\/+/g, '/');
    throw new BadRequestException(
      (lastErr ? `${lastErr}\n\n` : '') +
        `Remote server has no webhook agent on http://127.0.0.1:${port}${healthPath}. ` +
        'Weehawk can install Go from go.dev under /usr/local/go, push agent source, and run go build (unless WEEHAWK_REMOTE_GO_AUTO_INSTALL is disabled). ' +
        'Optional: WEEHAWK_WEBHOOK_AGENT_DOWNLOAD_URL or WEEHAWK_WEBHOOK_AGENT_BINARY. ' +
        'The SSH user needs passwordless sudo for tar, /usr/local/go, and systemctl.',
    );
  }

  private async installRemoteWebhookAgentFromGoSource(
    remoteServerId: number,
    projectUserId: number | null,
    sourceDir: string,
    unitB64: string,
  ): Promise<void> {
    const mainGo = await fs.readFile(path.join(sourceDir, 'main.go'));
    const goMod = await fs.readFile(path.join(sourceDir, 'go.mod'));
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const remoteSrc = `/tmp/weehawk_wa_src_${randomBytes(16).toString('hex')}`;
    const srcQ = remoteSrc.replace(/'/g, `'\\''`);
    const b64Q = `'${unitB64.replace(/'/g, `'\\''`)}'`;
    const systemd = `echo ${b64Q} | base64 -d | sudo -n tee /etc/systemd/system/weehawk-webhook-agent.service > /dev/null
sudo -n chmod 644 /etc/systemd/system/weehawk-webhook-agent.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now weehawk-webhook-agent`;
    const goPreamble = this.bashEnsureGoToolchainForWebhookBuild();
    const body = `set -euo pipefail
DIR='${srcQ}'
trap 'rm -rf "$DIR"' EXIT
${goPreamble}
cd "$DIR"
go build -trimpath -ldflags="-s -w" -o /tmp/weehawk-webhook-agent-bin .
sudo -n install -m 0755 /tmp/weehawk-webhook-agent-bin /usr/local/bin/weehawk-webhook-agent
rm -f /tmp/weehawk-webhook-agent-bin
${systemd}
`;

    await this.withSshClient(rs, pem, async (client) => {
      await this.sshExecCollectOutput(client, `mkdir -p '${srcQ}'`);
      await this.sftpWriteRemoteBuffer(client, `${remoteSrc}/main.go`, mainGo);
      await this.sftpWriteRemoteBuffer(client, `${remoteSrc}/go.mod`, goMod);
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        body,
        undefined,
      );
    });
  }

  private async installRemoteWebhookAgentFromUrl(
    remoteServerId: number,
    projectUserId: number | null,
    downloadUrl: string,
    unitB64: string,
  ): Promise<void> {
    const urlQ = `'${downloadUrl.replace(/'/g, `'\\''`)}'`;
    const b64Q = `'${unitB64.replace(/'/g, `'\\''`)}'`;
    const body = `set -euo pipefail
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
if command -v curl >/dev/null 2>&1; then
  curl -fsSL ${urlQ} -o "$TMP"
elif command -v wget >/dev/null 2>&1; then
  wget -q ${urlQ} -O "$TMP"
else
  echo 'curl or wget is required on the remote host' >&2
  exit 1
fi
chmod +x "$TMP"
sudo -n install -m 0755 "$TMP" /usr/local/bin/weehawk-webhook-agent
echo ${b64Q} | base64 -d | sudo -n tee /etc/systemd/system/weehawk-webhook-agent.service > /dev/null
sudo -n chmod 644 /etc/systemd/system/weehawk-webhook-agent.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now weehawk-webhook-agent
`;
    await this.execDockerCliOnRemoteViaSsh(remoteServerId, projectUserId, body);
  }

  private async installRemoteWebhookAgentFromLocalBinary(
    remoteServerId: number,
    projectUserId: number | null,
    localBinaryPath: string,
    unitB64: string,
  ): Promise<void> {
    const abs = path.resolve(localBinaryPath);
    if (!path.isAbsolute(abs)) {
      throw new BadRequestException(
        'WEEHAWK_WEBHOOK_AGENT_BINARY must be an absolute path.',
      );
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch {
      throw new BadRequestException(
        `WEEHAWK_WEBHOOK_AGENT_BINARY file not readable: ${abs}`,
      );
    }
    if (buf.length < 512) {
      throw new BadRequestException(
        'WEEHAWK_WEBHOOK_AGENT_BINARY file is too small to be a valid binary.',
      );
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const remoteTmp = `/tmp/weehawk_wa_${randomBytes(16).toString('hex')}`;
    const tmpQ = remoteTmp.replace(/'/g, `'\\''`);
    const b64Q = `'${unitB64.replace(/'/g, `'\\''`)}'`;
    const body = `set -euo pipefail
sudo -n install -m 0755 '${tmpQ}' /usr/local/bin/weehawk-webhook-agent
rm -f '${tmpQ}'
echo ${b64Q} | base64 -d | sudo -n tee /etc/systemd/system/weehawk-webhook-agent.service > /dev/null
sudo -n chmod 644 /etc/systemd/system/weehawk-webhook-agent.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now weehawk-webhook-agent
`;
    await this.withSshClient(rs, pem, async (client) => {
      await this.sftpWriteRemoteBuffer(client, remoteTmp, buf);
      await this.sshExecCollectOutput(client, `chmod 700 '${tmpQ}'`);
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        body,
        undefined,
      );
    });
  }

  /**
   * Writes `{token}.sh` + `{token}.env` under {@link WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}.
   * Call {@link ensureRemoteWebhookListening} first so the agent (Swarm or systemd) is running.
   */
  async writeRemoteWebhookScript(
    remoteServerId: number,
    projectUserId: number | null,
    scriptToken: string,
    scriptBody: string,
    notificationEnvLines: string[],
  ): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(scriptToken)) {
      throw new BadRequestException('Invalid webhook script token.');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const envPath = `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.env`;
    const scriptPath = `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.sh`;
    const installScript = buildRemoteEnvAndWrappedShInstallScript({
      parentDirShQuoted: remoteInstallShQuote(
        WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR,
      ),
      envPath,
      scriptPath,
      envLines: notificationEnvLines,
      userScriptBody: scriptBody,
      defaults: REMOTE_NOTIFY_DEFAULTS_WEBHOOK,
      truncateLogOnStart: true,
      runUserScriptOnHostViaDockerSocket: true,
    });
    const deployBaseQ = WEEHAWK_REMOTE_DEPLOYMENTS_BASE.replace(/'/g, `'\\''`);
    await this.withSshClient(rs, pem, async (client) => {
      await this.sshExecIgnoreFailure(client, `mkdir -p '${deployBaseQ}'`);
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        installScript,
        undefined,
      );
    });
  }

  async removeRemoteWebhookScript(
    remoteServerId: number,
    projectUserId: number | null,
    scriptToken: string,
  ): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(scriptToken)) {
      return;
    }
    const rs = await this.resolveRemoteServerForProjectContextOrNull(
      remoteServerId,
      projectUserId,
    );
    if (!rs) {
      return;
    }
    const pem = await this.resolvePrivateKeyPem(rs);
    const shQ =
      `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.sh`.replace(
        /'/g,
        `'\\''`,
      );
    const envQ =
      `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.env`.replace(
        /'/g,
        `'\\''`,
      );
    await this.withSshClient(rs, pem, async (client) => {
      await this.sshExecIgnoreFailure(client, `rm -f '${shQ}' '${envQ}'`);
    });
  }

  async readRemoteWebhookScriptLog(
    remoteServerId: number,
    projectUserId: number | null,
    scriptToken: string,
    opts?: { lines?: number },
  ): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(scriptToken)) {
      throw new BadRequestException('Invalid webhook script token.');
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const linesRaw = opts?.lines ?? 200;
    const lines =
      Number.isFinite(linesRaw) && linesRaw > 0
        ? Math.min(Math.floor(linesRaw), 2000)
        : 200;
    const logPath =
      `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.log`.replace(
        /'/g,
        `'\\''`,
      );
    const script = `
set -e
if [ ! -f '${logPath}' ]; then
  echo ''
  exit 0
fi
if command -v tail >/dev/null 2>&1; then
  tail -n ${lines} '${logPath}'
else
  cat '${logPath}'
fi
`;
    const out = await this.withSshClient(rs, pem, async (client) =>
      this.execSshBashScriptCollectOutputOnClient(client, script, undefined),
    );
    return out.stdout;
  }

  /**
   * `docker stack deploy` on the remote Swarm manager: uploads compose (+ optional isolated DOCKER_CONFIG)
   * and runs the CLI there — same registry auth pattern as local `mergePushEnvForImageRef`.
   */
  async stackDeployViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    params: {
      composeYaml: string;
      stackName: string;
      /** When set, upload `config.json` and set DOCKER_CONFIG for `--with-registry-auth`. */
      localDockerConfigDir?: string;
      /** Stream remote `docker` stdout/stderr (e.g. {@link emitDeployLog} for SSE). */
      onChunk?: (s: string) => void;
      /**
       * Service environment (same as Weehawk `service.env`) for compose `${VAR}` substitution
       * during `docker stack deploy` on the remote host. Without this, DB stacks see empty
       * `POSTGRES_PASSWORD` etc.
       */
      deployEnv?: Record<string, string>;
    },
  ): Promise<{ stdout: string; stderr: string }> {
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const remoteDir = `/tmp/weehawk_sd_${randomBytes(12).toString('hex')}`;
    const stackQ = params.stackName.replace(/'/g, `'\\''`);

    let configJson: string | undefined;
    if (params.localDockerConfigDir?.trim()) {
      const cfgPath = path.join(
        params.localDockerConfigDir.trim(),
        'config.json',
      );
      try {
        configJson = await fs.readFile(cfgPath, 'utf8');
      } catch {
        configJson = undefined;
      }
    }

    const onChunk = params.onChunk;
    return await this.withSshClient(rs, pem, async (client) => {
      try {
        await this.sshExecCollectOutput(
          client,
          `mkdir -p '${remoteDir}/docker-config'`,
          onChunk,
        );
        onChunk?.('Uploading compose to remote host…\n');
        await this.sftpWriteRemoteFile(
          client,
          `${remoteDir}/docker-compose.yml`,
          params.composeYaml,
        );
        if (configJson != null) {
          await this.sftpWriteRemoteFile(
            client,
            `${remoteDir}/docker-config/config.json`,
            configJson,
          );
        }
        const envExports = bashExportBlockForStackDeploy(
          params.deployEnv ?? {},
        );
        const deployScript = `set -euo pipefail
${envExports}
cd '${remoteDir}'
if [ -f docker-config/config.json ]; then
  export DOCKER_CONFIG='${remoteDir}/docker-config'
  docker stack deploy -c docker-compose.yml --with-registry-auth '${stackQ}'
else
  docker stack deploy -c docker-compose.yml --with-registry-auth '${stackQ}'
fi
`;
        const result = await this.execSshBashScriptCollectOutputOnClient(
          client,
          deployScript,
          onChunk,
        );
        await this.copyRemoteStackDeployToPersistentMirror(
          client,
          remoteDir,
          params.stackName,
          params.deployEnv,
          onChunk,
        );
        return result;
      } finally {
        await this.sshExecIgnoreFailure(client, `rm -rf '${remoteDir}'`);
      }
    });
  }

  /**
   * Keeps a copy of the last stack deploy bundle under {@link WEEHAWK_REMOTE_DEPLOYMENTS_BASE}
   * for on-host redeploy scripts.
   */
  private async copyRemoteStackDeployToPersistentMirror(
    client: Client,
    remoteTempDir: string,
    stackName: string,
    deployEnv: Record<string, string> | undefined,
    onChunk?: (s: string) => void,
  ): Promise<void> {
    const tempQ = shSingleQuoteRemote(remoteTempDir);
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(stackName)}`;
    const persistQ = shSingleQuoteRemote(persist);
    const mirrorScript = `set -euo pipefail
mkdir -p ${persistQ}
cp -f ${tempQ}/docker-compose.yml ${persistQ}/
if [ -d ${tempQ}/docker-config ]; then
  rm -rf ${persistQ}/docker-config
  cp -a ${tempQ}/docker-config ${persistQ}/
fi
`;
    await this.execSshBashScriptCollectOutputOnClient(
      client,
      mirrorScript,
      onChunk,
    );
    const envExports = bashExportBlockForStackDeploy(deployEnv ?? {});
    if (envExports.trim()) {
      await this.sftpWriteRemoteFile(
        client,
        `${persist}/weehawk-stack-env.sh`,
        `${envExports}\n`,
      );
    } else {
      await this.sshExecIgnoreFailure(
        client,
        `rm -f ${persistQ}/weehawk-stack-env.sh`,
      );
    }
  }

  /** Writes compose for non-Swarm remote projects to the same persistent dir layout as stacks. */
  async mirrorDockerComposeToRemotePersistent(
    remoteServerId: number,
    projectUserId: number | null,
    params:
      | { localComposeAbsolutePath: string; projectName: string }
      | { composeYaml: string; projectName: string },
  ): Promise<void> {
    const yaml =
      'composeYaml' in params
        ? params.composeYaml
        : await fs.readFile(params.localComposeAbsolutePath, 'utf8');
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(params.projectName)}`;
    const remoteYml = `${persist}/docker-compose.yml`;
    const persistQ = persist.replace(/'/g, `'\\''`);
    await this.withSshClient(rs, pem, async (client) => {
      await this.sshExecCollectOutput(
        client,
        `mkdir -p '${persistQ}'`,
        undefined,
      );
      await this.sftpWriteRemoteFile(client, remoteYml, yaml);
    });
  }

  /**
   * Writes compose (and optional registry config + env exports) under {@link WEEHAWK_REMOTE_DEPLOYMENTS_BASE}
   * without running `docker stack deploy` — same layout as after a successful remote stack deploy mirror.
   */
  async writePersistentDeploymentMirror(
    remoteServerId: number,
    projectUserId: number | null,
    params: {
      stackName: string;
      composeYaml: string;
      deployEnv?: Record<string, string>;
      localDockerConfigDir?: string;
    },
  ): Promise<void> {
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(params.stackName)}`;
    const persistQ = persist.replace(/'/g, `'\\''`);

    let configJson: string | undefined;
    if (params.localDockerConfigDir?.trim()) {
      const cfgPath = path.join(
        params.localDockerConfigDir.trim(),
        'config.json',
      );
      try {
        configJson = await fs.readFile(cfgPath, 'utf8');
      } catch {
        configJson = undefined;
      }
    }

    await this.withSshClient(rs, pem, async (client) => {
      await this.sshExecCollectOutput(
        client,
        `mkdir -p '${persistQ}'`,
        undefined,
      );
      await this.sftpWriteRemoteFile(
        client,
        `${persist}/docker-compose.yml`,
        params.composeYaml,
      );
      if (configJson != null) {
        await this.sshExecCollectOutput(
          client,
          `mkdir -p '${persistQ}/docker-config'`,
          undefined,
        );
        await this.sftpWriteRemoteFile(
          client,
          `${persist}/docker-config/config.json`,
          configJson,
        );
      } else {
        await this.sshExecIgnoreFailure(
          client,
          `rm -rf '${persistQ}/docker-config'`,
        );
      }
      const envExports = bashExportBlockForStackDeploy(params.deployEnv ?? {});
      if (envExports.trim()) {
        await this.sftpWriteRemoteFile(
          client,
          `${persist}/weehawk-stack-env.sh`,
          `${envExports}\n`,
        );
      } else {
        await this.sshExecIgnoreFailure(
          client,
          `rm -f '${persistQ}/weehawk-stack-env.sh'`,
        );
      }
    });
  }

  private static readonly MIRROR_SKIP_DIR_NAMES = new Set([
    'node_modules',
    '.git',
    '.svn',
    '__pycache__',
    '.next',
    'dist',
    'build',
    '.turbo',
    '.cache',
    'vendor',
    '.venv',
  ]);

  /** Relative POSIX paths under `localRootAbs` for SFTP upload (skips heavy dirs). */
  private async listRelativeFilePathsForDeploymentMirror(
    localRootAbs: string,
  ): Promise<string[]> {
    const root = path.resolve(localRootAbs);
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
          if (RemoteServersService.MIRROR_SKIP_DIR_NAMES.has(ent.name)) {
            continue;
          }
          await walk(full);
        } else if (ent.isFile()) {
          out.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    await walk(root);
    return out;
  }

  /**
   * Uploads a local directory tree to `remoteDirAbsolute` on the deploy host (e.g. …/app-source)
   * so on-host webhooks can run `docker build` without calling back to the API machine.
   */
  async mirrorLocalDirectoryToRemoteDeployment(
    remoteServerId: number,
    projectUserId: number | null,
    params: { localRootAbsolute: string; remoteDirAbsolute: string },
  ): Promise<void> {
    const localRoot = path.resolve(params.localRootAbsolute);
    try {
      const st = await fs.stat(localRoot);
      if (!st.isDirectory()) {
        throw new BadRequestException(
          `Local mirror path is not a directory: ${localRoot}`,
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      throw new BadRequestException(
        `Local mirror path not found: ${localRoot}`,
      );
    }
    const files =
      await this.listRelativeFilePathsForDeploymentMirror(localRoot);
    if (files.length === 0) {
      return;
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const remoteDir = params.remoteDirAbsolute
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');

    await this.withSshClient(rs, pem, async (client) => {
      const rdq = remoteDir.replace(/'/g, `'\\''`);
      await this.sshExecCollectOutput(
        client,
        `rm -rf '${rdq}' && mkdir -p '${rdq}'`,
        undefined,
      );
      const dirs = new Set<string>();
      for (const rel of files) {
        const pd = path.posix.dirname(rel);
        if (pd && pd !== '.') {
          let acc = '';
          for (const part of pd.split('/')) {
            acc = acc ? `${acc}/${part}` : part;
            dirs.add(acc);
          }
        }
      }
      const sorted = [...dirs].sort(
        (a, b) => a.split('/').length - b.split('/').length,
      );
      for (const d of sorted) {
        const rp = `${remoteDir}/${d}`.replace(/\/+/g, '/');
        const rpq = rp.replace(/'/g, `'\\''`);
        await this.sshExecCollectOutput(client, `mkdir -p '${rpq}'`, undefined);
      }
      for (const rel of files) {
        const abs = path.join(localRoot, ...rel.split('/'));
        const buf = await fs.readFile(abs);
        const rp = `${remoteDir}/${rel}`.replace(/\/+/g, '/');
        await this.sftpWriteRemoteBuffer(client, rp, buf);
      }
    });
  }

  /** Rolling restart each service in a stack (`docker service update --force`) on the remote host. */
  async forceRollingRestartStackViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    stackName: string,
    onChunk?: (s: string) => void,
  ): Promise<{ output: string; stderr: string }> {
    const stackQ = stackName.replace(/'/g, `'\\''`);
    const body = `SERVICES=$(docker stack services '${stackQ}' --format "{{.Name}}" 2>/dev/null || true)
for svc in $SERVICES; do
  [ -n "$svc" ] && docker service update --force "$svc" || true
done
`;
    const r = await this.execDockerCliOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      body,
      onChunk,
    );
    return {
      output: [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n'),
      stderr: r.stderr,
    };
  }

  /** `docker stack rm` on the remote host. */
  async stackRmViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    stackName: string,
  ): Promise<void> {
    const stackQ = stackName.replace(/'/g, `'\\''`);
    await this.execDockerCliOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      `docker stack rm '${stackQ}'`,
    );
  }

  /** Scale every service in the stack to 0 on the remote host. */
  async scaleAllStackServicesToZeroViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    stackName: string,
  ): Promise<void> {
    const stackQ = stackName.replace(/'/g, `'\\''`);
    const body = `SERVICES=$(docker stack services '${stackQ}' --format "{{.Name}}" 2>/dev/null || true)
for svc in $SERVICES; do
  [ -n "$svc" ] && docker service scale "$svc=0" || true
done
`;
    await this.execDockerCliOnRemoteViaSsh(remoteServerId, projectUserId, body);
  }

  /**
   * Creates a Swarm secret on the remote manager (required when stack YAML uses `secrets:` + `*_FILE`).
   * Local {@link DockerSecretsService} targets the API host — remote deploy must create secrets on the deploy host.
   */
  async ensureDockerSecretOnRemoteViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    secretName: string,
    secretValue: string,
  ): Promise<void> {
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    return await this.withSshClient(rs, pem, async (client) => {
      const exists = await this.sshExecExitCode(
        client,
        `docker secret inspect ${JSON.stringify(secretName)} >/dev/null 2>&1`,
      );
      if (exists === 0) {
        return;
      }
      await this.sshExecDockerSecretCreateStdin(
        client,
        secretName,
        secretValue,
      );
    });
  }

  /**
   * Creates many Swarm secrets using one SSH connection (avoids N× handshake latency)
   * and reports keys that already exist on the remote.
   */
  async bulkEnsureDockerSecretsOnRemoteViaSsh(
    remoteServerId: number,
    projectUserId: number | null,
    entries: Array<{ name: string; value: string }>,
  ): Promise<{
    created: string[];
    failed: Array<{ key: string; error: string }>;
    skipped: string[];
  }> {
    if (entries.length === 0) {
      return { created: [], failed: [], skipped: [] };
    }
    const rs = await this.resolveRemoteServerForProjectContext(
      remoteServerId,
      projectUserId,
    );
    const pem = await this.resolvePrivateKeyPem(rs);
    const created: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];
    const skipped: string[] = [];

    await this.withSshClient(rs, pem, async (client) => {
      for (const { name, value } of entries) {
        try {
          const exists = await this.sshExecExitCode(
            client,
            `docker secret inspect ${JSON.stringify(name)} >/dev/null 2>&1`,
          );
          if (exists === 0) {
            skipped.push(name);
            continue;
          }
          await this.sshExecDockerSecretCreateStdin(client, name, value);
          created.push(name);
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : 'Unknown error';
          failed.push({ key: name, error: msg });
        }
      }
    });

    return { created, failed, skipped };
  }

  /** Returns process exit code (0–255). */
  private async sshExecExitCode(
    client: Client,
    command: string,
  ): Promise<number> {
    return await new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        stream.on('close', (code: number) => {
          resolve(code ?? 0);
        });
        stream.resume();
        stream.stderr?.resume();
      });
    });
  }

  private async sshExecDockerSecretCreateStdin(
    client: Client,
    secretName: string,
    secretValue: string,
  ): Promise<void> {
    const cmd = `docker secret create ${JSON.stringify(secretName)} -`;
    return await new Promise((resolve, reject) => {
      client.exec(cmd, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let stderr = '';
        stream.on('data', () => {
          /* drain stdout — docker secret create prints the secret id; ignoring it can stall the session */
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        stream.on('close', (code: number) => {
          if (code === 0) {
            resolve();
          } else {
            const stderrSafe = stderr.trim().slice(0, 2000);
            this.logger.error(
              `Remote docker secret create failed (exit=${code}, secret="${secretName}").`,
              stderrSafe || '(no stderr)',
            );
            reject(
              new InternalServerErrorException(
                'Docker operation failed on remote host',
              ),
            );
          }
        });
        stream.end(Buffer.from(secretValue, 'utf8'));
      });
    });
  }

  /**
   * Dockerode-over-SSH (ssh2), same approach as Dokploy — avoids spawning `docker` + system `ssh`
   * so Windows hosts are not blocked by DOCKER_SSH_OPTS / interactive host-key prompts.
   */
  private createDockerodeForRemote(
    rs: RemoteServer,
    privateKeyPem: string,
  ): Dockerode {
    const p = this.getSshConnectParams(rs, privateKeyPem);
    return new Dockerode({
      host: p.host,
      port: p.port,
      username: p.username,
      protocol: 'ssh',
      sshOptions: {
        privateKey: p.privateKey,
        readyTimeout: 60_000,
        hostVerifier: this.buildSshHostVerifier(rs),
        ...(p.family != null ? { family: p.family } : {}),
      },
    });
  }

  /**
   * Docker CLI uses DOCKER_HOST=ssh://user@host[:port] and DOCKER_SSH_OPTS for identity / options.
   * Swarm stack deploy / stack ops when `remoteServerId` is set are implemented via {@link stackDeployViaSsh}
   * and {@link execDockerCliOnRemoteViaSsh} so the API host does not rely on `docker` + dial-stdio (e.g. Windows).
   */
  async dockerHostEnvForServer(
    rs: RemoteServer,
  ): Promise<Record<string, string>> {
    const identityPath = await this.resolveIdentityFilePath(rs);
    const raw = rs.host.trim();
    const isLoopback = isLoopbackSshHost(raw);
    // Use `localhost` in ssh:// so OpenSSH matches [localhost]:port in known_hosts (avoids yes/no prompts).
    // With `-4`, resolution stays on 127.0.0.1 so we don't hit ::1 when sshd listens on IPv4 only (common on Windows).
    const host = isLoopback ? 'localhost' : raw;
    const userHost =
      rs.port === 22
        ? `${rs.sshUser}@${host}`
        : `${rs.sshUser}@${host}:${rs.port}`;
    const parts = [
      `-i "${identityPath.replace(/"/g, '\\"')}"`,
      ...(isLoopback ? (['-4'] as const) : []),
      '-o BatchMode=yes',
      '-o StrictHostKeyChecking=accept-new',
      '-o NoHostAuthenticationForLocalhost=yes',
    ];
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
    const { userId: projectUserId, organizationId: projectOrganizationId } =
      await this.resolveProjectScope(service);
    const rs = await this.resolveRemoteServerForProjectContextOrNull(
      id,
      projectUserId,
    );
    if (!rs) {
      return base;
    }
    this.assertRemoteServerMatchesProject(rs, projectOrganizationId);
    if (rs.serverRole === 'build') {
      throw new BadRequestException(
        'This service uses a build-only host as its deploy target. Choose a deploy server under Remote servers.',
      );
    }
    if (isLoopbackSshHost(rs.host)) {
      throw new BadRequestException(
        'This service uses the local machine (loopback) as deploy target. Point deploy to a real remote host under Remote servers.',
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
    const scope = await this.resolveProjectScope(service);
    return this.mergeDockerHostEnvForBuildIds(
      base,
      {
        buildRemoteServerId:
          service.buildRemoteServerId ?? service.buildRemoteServer?.id ?? null,
        remoteServerId:
          service.remoteServerId ?? service.remoteServer?.id ?? null,
        buildOnLocalDockerHost: service.buildOnLocalDockerHost === true,
      },
      scope.userId,
      scope.organizationId,
    );
  }

  /** Same as {@link mergeDockerHostEnvForBuild} but uses FK columns read from `services` (reliable during deploy). */
  async mergeDockerHostEnvForBuildIds(
    base: NodeJS.ProcessEnv,
    ids: {
      buildRemoteServerId: number | null;
      remoteServerId: number | null;
      buildOnLocalDockerHost?: boolean;
    },
    projectUserId: number | null,
    projectOrganizationId: number | null,
  ): Promise<NodeJS.ProcessEnv> {
    const toCheck = new Set<number>();
    if (ids.remoteServerId != null) toCheck.add(ids.remoteServerId);
    if (ids.buildRemoteServerId != null) toCheck.add(ids.buildRemoteServerId);
    for (const rid of toCheck) {
      const row = await this.resolveRemoteServerForProjectContext(
        rid,
        projectUserId,
      );
      this.assertRemoteServerMatchesProject(row, projectOrganizationId);
    }
    const id = ids.buildRemoteServerId ?? ids.remoteServerId;
    if (id == null) {
      return base;
    }
    const rs = await this.resolveRemoteServerForProjectContextOrNull(
      id,
      projectUserId,
    );
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
    projectUserId: number | null,
    projectOrganizationId: number | null,
  ): Promise<NodeJS.ProcessEnv> {
    if (remoteServerId == null) {
      return base;
    }
    const rs = await this.resolveRemoteServerForProjectContextOrNull(
      remoteServerId,
      projectUserId,
    );
    if (!rs) {
      return base;
    }
    this.assertRemoteServerMatchesProject(rs, projectOrganizationId);
    if (rs.serverRole === 'build') {
      throw new BadRequestException(
        'This service uses a build-only host as its deploy target. Choose a deploy server under Remote servers.',
      );
    }
    if (isLoopbackSshHost(rs.host)) {
      throw new BadRequestException(
        'This service uses the local machine (loopback) as deploy target. Point deploy to a real remote host under Remote servers.',
      );
    }
    const extra = await this.dockerHostEnvForServer(rs);
    return { ...base, ...extra };
  }

  async findAll(
    userId: number,
    organizationPublicId: string,
  ): Promise<RemoteServerSafe[]> {
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER },
    );
    const rows = await this.scopedRemoteServers.listForOrganization(
      userId,
      ctx.internalId,
      { order: { name: 'ASC' } },
    );
    return Promise.all(
      rows.map((r) => this.ensurePublicId(r).then((row) => this.toSafe(row))),
    );
  }

  async findOne(
    id: number | string,
    userId: number,
  ): Promise<RemoteServerSafe> {
    const rs = await this.findEntityOrFail(id, userId);
    return this.toSafe(rs);
  }

  /**
   * Resolve a deploy server for building a webhook trigger URL when the caller may lack a user
   * (e.g. org-owned project context). Uses membership-scoped lookup when `actingUserId` is set.
   */
  async findSafeForRemoteWebhookTrigger(
    remoteServerId: number,
    actingUserId: number | null,
  ): Promise<RemoteServerSafe> {
    if (actingUserId != null && actingUserId >= 1) {
      return this.findOne(remoteServerId, actingUserId);
    }
    const rs = await this._internal_system_findRemoteServerByIdOrFail(
      remoteServerId,
      'remote webhook trigger URL without user context',
    );
    return this.toSafe(rs);
  }

  private async ensurePublicId(row: RemoteServer): Promise<RemoteServer> {
    if (row.publicId) return row;
    row.publicId = generatePublicId('rsv');
    return this._internal_system_saveRemoteServer(
      row,
      'backfilling missing publicId on legacy rows',
    );
  }

  async resolveServerIdForUser(
    idOrPublicId: string,
    userId: number,
  ): Promise<number> {
    const row = await this.findEntityByPublicIdOrFail(idOrPublicId, userId);
    return row.id;
  }

  /**
   * Resolve server route id and enforce Docker Manager permission.
   * Use this for endpoints that run Docker commands on the remote host.
   */
  async resolveDockerManagerServerIdForUser(
    idOrPublicId: string,
    userId: number,
  ): Promise<number> {
    const row = await this.findEntityByPublicIdOrFail(idOrPublicId, userId);
    await this.assertOrgServerDockerIfNeeded(row, userId);
    return row.id;
  }

  async getOrganizationIdForUserServer(
    idOrPublicId: number | string,
    userId: number,
  ): Promise<number | null> {
    const row = await this.findEntityOrFail(idOrPublicId, userId);
    return Number.isFinite(row.organizationId) && row.organizationId >= 1
      ? row.organizationId
      : null;
  }

  /** Org audit metadata after a user-scoped remote server action succeeds. */
  async resolveRemoteServerAuditFields(
    idOrPublicId: number | string,
    userId: number,
  ): Promise<{
    organizationInternalId: number;
    publicId: string | null;
    name: string;
  } | null> {
    try {
      const rs = await this.findEntityOrFail(idOrPublicId, userId);
      if (!Number.isFinite(rs.organizationId) || rs.organizationId < 1) {
        return null;
      }
      const ensured = await this.ensurePublicId(rs);
      return {
        organizationInternalId: Math.trunc(rs.organizationId),
        publicId: ensured.publicId ?? null,
        name: ensured.name,
      };
    } catch {
      return null;
    }
  }

  /**
   * Interactive WebSocket SSH terminal (`/ws/remote-terminal`): log when an
   * interactive shell is successfully allocated (distinct from one-shot
   * {@link RemoteServersService.runRemoteTerminalCommand} / `security.remote_terminal.exec`).
   */
  auditRemoteTerminalInteractiveSessionOpened(
    remoteServerId: number,
    userId: number,
  ): void {
    void (async () => {
      const ctx = await this.resolveRemoteServerAuditFields(
        remoteServerId,
        userId,
      );
      if (ctx == null) {
        return;
      }
      await this.organizationsService.appendOrganizationAuditEvent(
        ctx.organizationInternalId,
        userId,
        'security.remote_terminal.session_opened',
        {
          metadata: {
            endpoint: 'WS /ws/remote-terminal',
            remoteServerPublicId: ctx.publicId,
            remoteServerName: ctx.name,
          },
        },
      );
    })().catch(() => undefined);
  }

  /** Resolve route identifier for WS-style endpoints that use only publicId. */
  async resolveServerIdByPublicId(publicId: string): Promise<number> {
    const raw = String(publicId).trim();
    const row = await this._internal_system_findRemoteServerByPublicIdOrFail(
      raw,
      'publicId routes do not include authenticated user context',
    );
    const ensured = await this.ensurePublicId(row);
    return ensured.id;
  }

  async assertDeployServerById(
    id: number,
    projectUserId: number | null,
  ): Promise<{ name: string }> {
    const rs =
      projectUserId != null
        ? await this.findEntityOrFail(id, projectUserId)
        : await this._internal_system_findRemoteServerByIdOrFail(
            id,
            'project ownership may be unavailable for system-driven deploy assertions',
          );
    if (rs.serverRole !== 'deploy') {
      throw new BadRequestException(
        `Remote server "${rs.name}" is build-only. Choose a deploy server (not a build host).`,
      );
    }
    if (isLoopbackSshHost(rs.host)) {
      throw new BadRequestException(
        `Remote server "${rs.name}" points to the local machine (loopback). It cannot be used as a deploy host — use a real remote server, or use this entry only for image builds.`,
      );
    }
    return { name: rs.name };
  }

  /**
   * GET a presigned URL from the deploy host (URL is written via SFTP). Used to confirm the host
   * can reach object storage the same way backup/upload flows do.
   */
  async curlPresignedProbeOnRemote(
    remoteServerId: number,
    projectUserId: number | null,
    presignedUrl: string,
  ): Promise<void> {
    const u = presignedUrl.trim();
    if (!/^https?:\/\//i.test(u)) {
      throw new BadRequestException('Invalid presigned URL.');
    }
    const rs =
      projectUserId != null
        ? await this.findEntityOrFail(remoteServerId, projectUserId)
        : await this._internal_system_findRemoteServerByIdOrFail(
            remoteServerId,
            'presigned probe can be run from non-user system contexts',
          );
    if (projectUserId != null) {
      await this.assertOrgServerInstallMaintainIfNeeded(rs, projectUserId);
    }
    const pem = await this.resolvePrivateKeyPem(rs);
    const token = randomBytes(8).toString('hex');
    const urlFile = `/tmp/weehawk-s3-probe-url-${token}`;
    const urlQ = shSingleQuoteRemote(urlFile);
    await this.withSshClient(rs, pem, async (client) => {
      await this.sftpWriteRemoteBuffer(client, urlFile, Buffer.from(u, 'utf8'));
      await this.execSshBashScriptCollectOutputOnClient(
        client,
        `set -euo pipefail
U=$(tr -d '\\n\\r' < ${urlQ})
rm -f ${urlQ}
curl -fsS -o /dev/null "$U"
`,
        undefined,
      );
    });
  }

  /**
   * For SSH provision worker: load row + decrypted PEM after ownership check.
   */
  async getSshProvisionContext(
    id: number,
    userId: number,
  ): Promise<{ server: RemoteServer; privateKeyPem: string }> {
    const server = await this.findEntityOrFail(id, userId);
    await this.assertOrgServerInstallMaintainIfNeeded(server, userId);
    const privateKeyPem = await this.resolvePrivateKeyPem(server);
    return { server, privateKeyPem };
  }

  /**
   * Runs the same `send_notification` curl logic as cron/webhook remote scripts on the deploy host
   * so outbound provider traffic uses the customer's network, not the API server.
   */
  async deliverNotificationChannelViaDeployHost(
    remoteServerId: number,
    userId: number,
    runtime: NotificationChannelRuntimeConfig,
    plainText: string,
  ): Promise<ProviderSendResult> {
    const cred = buildRemoteNotificationCredentialEnvLines(runtime);
    if (cred.length === 1 && cred[0] === 'WEEHAWK_NOTIFY_ENABLED=0') {
      return {
        ok: false,
        description:
          'This channel type cannot be sent from a deploy host. Use a supported provider (Telegram, Slack, Discord, etc.) or clear the deploy server on the channel.',
      };
    }
    const rs = await this.findEntityOrFail(remoteServerId, userId);
    await this.assertOrgServerInstallMaintainIfNeeded(rs, userId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const tag = `WHNK_MSG_${randomBytes(16).toString('hex')}`;
    const exportsBlock = cred.map((line) => `export ${line}`).join('\n');
    const strictBash = remoteNotifyDispatchFunctionsBashStrict('Notification');
    const script = [
      'set -euo pipefail',
      exportsBlock,
      strictBash,
      `MSG=$(cat <<'${tag}'`,
      plainText.replace(/\r\n/g, '\n'),
      tag,
      ')',
      'send_notification "$MSG"',
      '',
    ].join('\n');
    try {
      await this.execSshBashScriptCollectOutput(rs, pem, script);
      return { ok: true, response: 'delivered-via-deploy-host' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, description: msg };
    }
  }

  /**
   * Same as {@link deliverNotificationChannelViaDeployHost} for organization-owned automation
   * (e.g. cron) where there is no acting user: resolves the deploy host by id and verifies it
   * belongs to {@link organizationInternalId}.
   */
  async deliverNotificationChannelForOrganization(
    remoteServerId: number,
    organizationInternalId: number,
    runtime: NotificationChannelRuntimeConfig,
    plainText: string,
  ): Promise<ProviderSendResult> {
    const cred = buildRemoteNotificationCredentialEnvLines(runtime);
    if (cred.length === 1 && cred[0] === 'WEEHAWK_NOTIFY_ENABLED=0') {
      return {
        ok: false,
        description:
          'This channel type cannot be sent from a deploy host. Use a supported provider (Telegram, Slack, Discord, etc.) or clear the deploy server on the channel.',
      };
    }
    const rs = await this._internal_system_findRemoteServerByIdOrFail(
      remoteServerId,
      'organization-scoped notification delivery',
    );
    if (rs.organizationId !== organizationInternalId) {
      return {
        ok: false,
        description: 'Remote server is not in this organization.',
      };
    }
    const pem = await this.resolvePrivateKeyPem(rs);
    const tag = `WHNK_MSG_${randomBytes(16).toString('hex')}`;
    const exportsBlock = cred.map((line) => `export ${line}`).join('\n');
    const strictBash = remoteNotifyDispatchFunctionsBashStrict('Notification');
    const script = [
      'set -euo pipefail',
      exportsBlock,
      strictBash,
      `MSG=$(cat <<'${tag}'`,
      plainText.replace(/\r\n/g, '\n'),
      tag,
      ')',
      'send_notification "$MSG"',
      '',
    ].join('\n');
    try {
      await this.execSshBashScriptCollectOutput(rs, pem, script);
      return { ok: true, response: 'delivered-via-deploy-host' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, description: msg };
    }
  }

  /** For WebSocket remote terminal. */
  async getSshTerminalContext(id: number, userId: number): Promise<{
    remoteServerId: number;
    connect: ConnectConfig;
  }> {
    const rs = await this.resolveRemoteServerForUser(id, userId);
    await this.assertOrgServerTerminalIfNeeded(rs, userId);
    return this._internal_getSshTerminalContext(rs);
  }

  private async _internal_getSshTerminalContext(rs: RemoteServer): Promise<{
    remoteServerId: number;
    connect: ConnectConfig;
  }> {
    const pem = await this.resolvePrivateKeyPem(rs);
    return {
      remoteServerId: rs.id,
      connect: this.getSsh2ConnectOptions(rs, pem, 120_000),
    };
  }

  private async withOrgServerAccessCheck(
    rs: RemoteServer,
    userId: number,
  ): Promise<RemoteServer> {
    const ensured = await this.ensurePublicId(rs);
    await this.organizationsService.assertMemberCanAccessOrgRemoteServersWorkspace(
      userId,
      ensured.organizationId,
    );
    return ensured;
  }

  private async assertOrgServerEditIfNeeded(
    rs: RemoteServer,
    userId: number,
  ): Promise<void> {
    await this.organizationsService.assertMemberCanEditOrgRemoteServerRow(
      userId,
      rs.organizationId,
    );
  }

  private async assertOrgServerDeleteIfNeeded(
    rs: RemoteServer,
    userId: number,
  ): Promise<void> {
    await this.organizationsService.assertMemberCanDeleteOrgRemoteServer(
      userId,
      rs.organizationId,
    );
  }

  private async assertOrgServerInstallMaintainIfNeeded(
    rs: RemoteServer,
    userId: number,
  ): Promise<void> {
    await this.organizationsService.assertMemberCanInstallMaintainOrgRemoteServers(
      userId,
      rs.organizationId,
    );
  }

  private async assertOrgServerTerminalIfNeeded(
    rs: RemoteServer,
    userId: number,
  ): Promise<void> {
    await this.organizationsService.assertMemberCanUseOrgRemoteTerminal(
      userId,
      rs.organizationId,
    );
  }

  private async assertOrgServerDockerIfNeeded(
    rs: RemoteServer,
    userId: number,
  ): Promise<void> {
    await this.organizationsService.assertMemberCanUseOrgRemoteDockerManager(
      userId,
      rs.organizationId,
    );
  }

  /**
   * Row-level access + manage remote_server (provision / install queues).
   */
  async assertRemoteServerProvisionEnqueueAllowed(
    remoteServerId: number,
    userId: number,
  ): Promise<RemoteServer> {
    const rs = await this.findEntityOrFail(remoteServerId, userId);
    await this.assertOrgServerInstallMaintainIfNeeded(rs, userId);
    return rs;
  }

  private async findEntityOrFail(
    id: number | string,
    userId: number,
  ): Promise<RemoteServer> {
    const rs = await this.scopedRemoteServers.findScoped(Number(id), userId);
    return this.withOrgServerAccessCheck(rs, userId);
  }

  private async resolveRemoteServerForUser(
    id: number,
    userId: number,
  ): Promise<RemoteServer> {
    return this.findEntityOrFail(id, userId);
  }

  private async resolveRemoteServerForProjectContext(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<RemoteServer> {
    if (projectUserId != null) {
      return this.findEntityOrFail(remoteServerId, projectUserId);
    }
    return this._internal_system_findRemoteServerByIdOrFail(
      remoteServerId,
      'project-scoped operation may run without user context',
    );
  }

  private async resolveRemoteServerForProjectContextOrNull(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<RemoteServer | null> {
    if (projectUserId != null) {
      try {
        return await this.findEntityOrFail(remoteServerId, projectUserId);
      } catch (e) {
        if (e instanceof NotFoundException) return null;
        throw e;
      }
    }
    return this._internal_system_findRemoteServerByIdOrNull(
      remoteServerId,
      'best-effort lookup may run without user context',
    );
  }

  private async findEntityByPublicIdOrFail(
    idOrPublicId: string,
    userId: number,
  ): Promise<RemoteServer> {
    const raw = String(idOrPublicId).trim();
    const rs = await this.scopedRemoteServers.findScopedBy(
      'publicId',
      raw,
      userId,
    );
    return this.withOrgServerAccessCheck(rs, userId);
  }

  async create(
    dto: CreateRemoteServerDto,
    userId: number,
  ): Promise<RemoteServerSafe> {
    const pem = dto.privateKey.trim();
    const privateKeyEncrypted = encryptPrivateKey(
      pem,
      this.getEncryptionSecret(),
    );

    const hostTrimmed = dto.host.trim();
    await this.enforcePublicRemoteSshTargets(hostTrimmed, dto.publicIpv4);
    const serverRole: 'deploy' | 'build' =
      dto.serverRole === 'build' ? 'build' : 'deploy';

    const rawOrg = dto.organizationPublicId.trim();
    const ctx = await this.organizationsService.requireMemberContext(
      rawOrg,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER,
      },
    );
    const organizationId = ctx.internalId;
    await this.organizationsService.assertMemberCanAddOrgRemoteServer(
      userId,
      organizationId,
    );

    const entity = this.remoteServerRepository.create({
      publicId: generatePublicId('rsv'),
      organizationId,
      name: dto.name.trim(),
      host: hostTrimmed,
      port: dto.port ?? 22,
      sshUser: dto.sshUser.trim(),
      serverRole,
      privateKeyEncrypted,
      publicIpv4: dto.publicIpv4?.trim() ? dto.publicIpv4.trim() : null,
      domainsJson:
        dto.domainsJson !== undefined && String(dto.domainsJson).trim()
          ? normalizeDomainsJsonInput(String(dto.domainsJson))
          : null,
    });
    const saved = await this.scopedRemoteServers.saveScoped(entity, userId);
    if (saved.organizationId != null) {
      void this.organizationsService
        .appendOrganizationAuditEvent(
          saved.organizationId,
          userId,
          'security.remote_server.created',
          {
            metadata: {
              endpoint: 'POST /api/remote-servers',
              remoteServerPublicId: saved.publicId ?? null,
              remoteServerName: saved.name,
              serverRole: saved.serverRole,
            },
          },
        )
        .catch(() => undefined);
    }
    if (
      saved.organizationId != null &&
      saved.domainsJson != null &&
      String(saved.domainsJson).trim()
    ) {
      await this.organizationsService.appendOrganizationAuditEvent(
        saved.organizationId,
        userId,
        'domains.deploy_hostnames_updated',
        {
          metadata: {
            endpoint: `POST /api/remote-servers`,
            remoteServerPublicId: saved.publicId ?? null,
            remoteServerName: saved.name,
            context: 'create',
            domainsHostCount: countDomainLabelsInDomainsJson(saved.domainsJson),
          },
        },
      );
    }
    if (organizationId >= 1) {
      this.orgRealtime.notifyOrgDataChanged(organizationId, {
        entity: 'remote_server',
        action: 'created',
        publicId: saved.publicId,
      });
    }
    return this.toSafe(saved);
  }

  private isDomainsJsonOnlyUpdate(dto: UpdateRemoteServerDto): boolean {
    const keys: (keyof UpdateRemoteServerDto)[] = [
      'name',
      'host',
      'port',
      'sshUser',
      'serverRole',
      'privateKey',
      'publicIpv4',
      'domainsJson',
      'organizationPublicId',
    ];
    const active = keys.filter((k) => dto[k] !== undefined);
    return active.length === 1 && active[0] === 'domainsJson';
  }

  async update(
    id: number,
    dto: UpdateRemoteServerDto,
    userId: number,
  ): Promise<RemoteServerSafe> {
    const existing = await this.findEntityOrFail(id, userId);
    if (this.isDomainsJsonOnlyUpdate(dto)) {
      await this.organizationsService.assertMemberCanEditOrgServerDomainsJson(
        userId,
        existing.organizationId,
      );
    } else {
      await this.assertOrgServerEditIfNeeded(existing, userId);
    }
    let privateKeyEncrypted: string | null | undefined =
      existing.privateKeyEncrypted;

    // @IsOptional() skips validators when a field is null; never call .trim() on null (TypeError → 500).
    if (dto.privateKey != null) {
      const pem = String(dto.privateKey).trim();
      if (pem.length > 0) {
        privateKeyEncrypted = encryptPrivateKey(
          pem,
          this.getEncryptionSecret(),
        );
      }
    }

    const nextEnc = privateKeyEncrypted ?? null;
    if (!nextEnc?.trim()) {
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

    const hostOrPortChanged =
      (dto.host != null && String(dto.host).trim() !== existing.host) ||
      (dto.port != null && dto.port !== existing.port);

    const merged = this.remoteServerRepository.merge(existing, {
      name: dto.name != null ? String(dto.name).trim() : existing.name,
      host: dto.host != null ? String(dto.host).trim() : existing.host,
      sshUser:
        dto.sshUser != null ? String(dto.sshUser).trim() : existing.sshUser,
      port: dto.port != null ? dto.port : existing.port,
      serverRole:
        dto.serverRole === 'build'
          ? 'build'
          : dto.serverRole === 'deploy'
            ? 'deploy'
            : existing.serverRole,
      publicIpv4:
        dto.publicIpv4 === undefined
          ? existing.publicIpv4
          : dto.publicIpv4 != null && String(dto.publicIpv4).trim()
            ? String(dto.publicIpv4).trim()
            : null,
      domainsJson:
        dto.domainsJson === undefined
          ? (existing.domainsJson ?? null)
          : normalizeDomainsJsonInput(
              dto.domainsJson == null ? undefined : String(dto.domainsJson),
            ),
      privateKeyEncrypted: nextEnc,
      ...(hostOrPortChanged ? { sshHostKeySha256: null } : {}),
    });
    if (isLoopbackSshHost(merged.host) && merged.serverRole === 'deploy') {
      const nDeploy = await svcRepo.count({
        where: { remoteServer: { id: merged.id } },
      });
      if (nDeploy > 0) {
        throw new BadRequestException(
          'The local machine (localhost / loopback) cannot be a deploy server. Point those services at a remote deploy host first, then set this entry to Build-only under Remote servers.',
        );
      }
    }
    if (dto.host !== undefined || dto.publicIpv4 !== undefined) {
      await this.enforcePublicRemoteSshTargets(merged.host, merged.publicIpv4);
    }
    const saved = await this.scopedRemoteServers.saveScoped(merged, userId);
    if (dto.domainsJson !== undefined && saved.organizationId != null) {
      const prevDomains = existing.domainsJson ?? null;
      const nextDomains = saved.domainsJson ?? null;
      if (prevDomains !== nextDomains) {
        await this.organizationsService.appendOrganizationAuditEvent(
          saved.organizationId,
          userId,
          'domains.deploy_hostnames_updated',
          {
            metadata: {
              endpoint: `PATCH /api/remote-servers/${saved.id}`,
              remoteServerPublicId: saved.publicId ?? null,
              remoteServerName: saved.name,
              context: 'update',
              domainsHostCountPrev: countDomainLabelsInDomainsJson(prevDomains),
              domainsHostCountNext: countDomainLabelsInDomainsJson(nextDomains),
            },
          },
        );
      }
    }
    if (
      saved.organizationId != null &&
      !this.isDomainsJsonOnlyUpdate(dto)
    ) {
      void this.organizationsService
        .appendOrganizationAuditEvent(
          saved.organizationId,
          userId,
          'security.remote_server.updated',
          {
            metadata: {
              endpoint: `PATCH /api/remote-servers/${saved.id}`,
              remoteServerPublicId: saved.publicId ?? null,
              remoteServerName: saved.name,
            },
          },
        )
        .catch(() => undefined);
    }
    const oid = saved.organizationId;
    if (oid != null && oid >= 1) {
      this.orgRealtime.notifyOrgDataChanged(oid, {
        entity: 'remote_server',
        action: 'updated',
        publicId: saved.publicId,
      });
    }
    return this.toSafe(saved);
  }

  private async _internal_system_findRemoteServerByIdOrFail(
    id: number,
    reason: string,
  ): Promise<RemoteServer> {
    // SYSTEM-LEVEL BYPASS: Required for [flows without authenticated userId context].
    void reason;
    const rs = await this.remoteServerRepository.findOne({ where: { id } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${id} not found`);
    }
    return rs;
  }

  private async _internal_system_findRemoteServerByIdOrNull(
    id: number,
    reason: string,
  ): Promise<RemoteServer | null> {
    // SYSTEM-LEVEL BYPASS: Required for [best-effort lookups without authenticated userId context].
    void reason;
    return this.remoteServerRepository.findOne({ where: { id } });
  }

  private async _internal_system_findRemoteServerHostKeyRowByIdOrNull(
    remoteServerId: number,
  ): Promise<Pick<RemoteServer, 'id' | 'sshHostKeySha256'> | null> {
    // SYSTEM-LEVEL BYPASS: Required for [TOFU host-key persistence without acting user context].
    return this.remoteServerRepository.findOne({
      where: { id: remoteServerId },
      select: { id: true, sshHostKeySha256: true },
    });
  }

  private async _internal_system_findRemoteServerByPublicIdOrFail(
    publicId: string,
    reason: string,
  ): Promise<RemoteServer> {
    // SYSTEM-LEVEL BYPASS: Required for [flows that resolve servers by publicId without user context].
    void reason;
    const rs = await this.remoteServerRepository.findOne({
      where: { publicId },
    });
    if (!rs) {
      throw new NotFoundException('Remote server not found');
    }
    return rs;
  }

  private async _internal_system_saveRemoteServer(
    row: RemoteServer,
    reason: string,
  ): Promise<RemoteServer> {
    // SYSTEM-LEVEL BYPASS: Required for [internal maintenance writes without acting user context].
    void reason;
    return this.remoteServerRepository.save(row);
  }

  async remove(id: number, userId: number): Promise<void> {
    const rs = await this.findEntityOrFail(id, userId);
    await this.assertOrgServerDeleteIfNeeded(rs, userId);
    const repo = this.remoteServerRepository.manager.getRepository(Service);
    const nDeploy = await repo.count({ where: { remoteServer: { id } } });
    const nBuild = await repo.count({ where: { buildRemoteServer: { id } } });
    const n = nDeploy + nBuild;
    if (n > 0) {
      throw new BadRequestException(
        `Cannot delete: ${n} service(s) still reference this remote server (deploy and/or build). Unlink them first.`,
      );
    }
    const orgId = rs.organizationId;
    await this.scopedRemoteServers.deleteScoped(id, userId);
    if (orgId != null) {
      void this.organizationsService
        .appendOrganizationAuditEvent(
          orgId,
          userId,
          'security.remote_server.deleted',
          {
            metadata: {
              endpoint: `DELETE /api/remote-servers/${id}`,
              remoteServerPublicId: rs.publicId ?? null,
              remoteServerName: rs.name,
            },
          },
        )
        .catch(() => undefined);
      if (orgId >= 1) {
        this.orgRealtime.notifyOrgDataChanged(orgId, {
          entity: 'remote_server',
          action: 'deleted',
          publicId: rs.publicId,
        });
      }
    }
  }

  private logOrgRemoteDockerMutation(
    id: number,
    userId: number,
    action: string,
    endpoint: string,
    extra?: Record<string, unknown>,
  ): void {
    void this.findEntityOrFail(id, userId)
      .then((rs) => {
        if (rs.organizationId == null) return;
        return this.organizationsService.appendOrganizationAuditEvent(
          rs.organizationId,
          userId,
          action,
          {
            metadata: {
              endpoint,
              remoteServerPublicId: rs.publicId ?? null,
              remoteServerName: rs.name,
              ...(extra ?? {}),
            },
          },
        );
      })
      .catch(() => undefined);
  }

  private async withRemoteDocker<T>(
    id: number,
    userId: number,
    fn: (docker: Dockerode) => Promise<T>,
  ): Promise<T> {
    const rs = await this.findEntityOrFail(id, userId);
    await this.assertOrgServerDockerIfNeeded(rs, userId);
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const docker = this.createDockerodeForRemote(rs, pem);
      try {
        return await fn(docker);
      } finally {
        await this.flushPendingSshHostKeyFingerprint(rs.id);
      }
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `Remote Docker console operation failed (host #${id}).`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Docker operation failed on remote host',
      );
    }
  }

  /** All files under `rootAbs` as POSIX paths relative to the context root (for Dockerode `buildImage` + .dockerignore). */
  private async collectRelativeFilePathsForDockerBuild(
    rootAbs: string,
  ): Promise<string[]> {
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
            if (typeof o.progress === 'string')
              textParts.push(`${o.progress}\n`);
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
    projectUserId: number | null,
    projectOrganizationId: number | null,
  ): Promise<{ output: string }> {
    const rs =
      projectUserId != null
        ? await this.findEntityOrFail(remoteServerId, projectUserId)
        : await this._internal_system_findRemoteServerByIdOrFail(
            remoteServerId,
            'dockerode build may run from projectless system automation',
          );
    this.assertRemoteServerMatchesProject(rs, projectOrganizationId);
    if (projectUserId != null) {
      await this.assertOrgServerDockerIfNeeded(rs, projectUserId);
    }
    const pem = await this.resolvePrivateKeyPem(rs);
    const docker = this.createDockerodeForRemote(rs, pem);
    try {
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
        this.logger.error(
          `Remote Docker build failed to start (host #${remoteServerId}).`,
          e instanceof Error ? e.stack : String(e),
        );
        throw new InternalServerErrorException(
          'Docker operation failed on remote host',
        );
      }
      try {
        const { text, streamError } = await this.followDockerProgressToString(
          docker,
          stream,
        );
        if (streamError) {
          this.logger.error(
            `Remote Docker build stream reported failure (host #${remoteServerId}).`,
            `${streamError}\n${text}`.trim(),
          );
          throw new InternalServerErrorException(
            'Docker operation failed on remote host',
          );
        }
        return { output: text.trim() || '(build finished with no log output)' };
      } catch (e) {
        if (
          e instanceof InternalServerErrorException ||
          e instanceof BadRequestException
        ) {
          throw e;
        }
        this.logger.error(
          `Remote Docker build failed (host #${remoteServerId}).`,
          e instanceof Error ? e.stack : String(e),
        );
        throw new InternalServerErrorException(
          'Docker operation failed on remote host',
        );
      }
    } finally {
      await this.flushPendingSshHostKeyFingerprint(remoteServerId);
    }
  }

  /** Push an image on a remote host via Dockerode (registry auth from caller). */
  async pushImageUsingDockerodeSsh(
    remoteServerId: number,
    params: {
      imageRef: string;
      auth: {
        username: string;
        password: string;
        serveraddress: string;
      } | null;
    },
    projectUserId: number | null,
    projectOrganizationId: number | null,
  ): Promise<{ output: string }> {
    const rs =
      projectUserId != null
        ? await this.findEntityOrFail(remoteServerId, projectUserId)
        : await this._internal_system_findRemoteServerByIdOrFail(
            remoteServerId,
            'dockerode push may run from projectless system automation',
          );
    this.assertRemoteServerMatchesProject(rs, projectOrganizationId);
    if (projectUserId != null) {
      await this.assertOrgServerDockerIfNeeded(rs, projectUserId);
    }
    const pem = await this.resolvePrivateKeyPem(rs);
    const docker = this.createDockerodeForRemote(rs, pem);
    try {
      const image = docker.getImage(params.imageRef);
      const opts: Record<string, unknown> = {};
      if (params.auth) {
        opts.authconfig = params.auth;
      }
      let stream: NodeJS.ReadableStream;
      try {
        stream = await image.push(opts);
      } catch (e) {
        this.logger.error(
          `Remote Docker push failed to start (host #${remoteServerId}, image="${params.imageRef}").`,
          e instanceof Error ? e.stack : String(e),
        );
        throw new InternalServerErrorException(
          'Docker operation failed on remote host',
        );
      }
      try {
        const { text, streamError } = await this.followDockerProgressToString(
          docker,
          stream,
        );
        if (streamError) {
          this.logger.error(
            `Remote Docker push stream reported failure (host #${remoteServerId}, image="${params.imageRef}").`,
            `${streamError}\n${text}`.trim(),
          );
          throw new InternalServerErrorException(
            'Docker operation failed on remote host',
          );
        }
        return { output: text.trim() || '(push finished with no log output)' };
      } catch (e) {
        if (
          e instanceof InternalServerErrorException ||
          e instanceof BadRequestException
        ) {
          throw e;
        }
        this.logger.error(
          `Remote Docker push failed (host #${remoteServerId}, image="${params.imageRef}").`,
          e instanceof Error ? e.stack : String(e),
        );
        throw new InternalServerErrorException(
          'Docker operation failed on remote host',
        );
      }
    } finally {
      await this.flushPendingSshHostKeyFingerprint(remoteServerId);
    }
  }

  async remoteConsoleContainersPaged(
    id: number,
    userId: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedContainersDto> {
    return this.withRemoteDocker(id, userId, (docker) =>
      pagedRemoteContainers(docker, page, pageSize, q),
    );
  }

  async remoteConsoleImagesPaged(
    id: number,
    userId: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedImagesDto> {
    return this.withRemoteDocker(id, userId, (docker) =>
      pagedRemoteImages(docker, page, pageSize, q),
    );
  }

  async remoteConsoleNetworksPaged(
    id: number,
    userId: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedNetworksDto> {
    return this.withRemoteDocker(id, userId, (docker) =>
      pagedRemoteNetworks(docker, page, pageSize, q),
    );
  }

  async remoteConsoleVolumesPaged(
    id: number,
    userId: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedVolumesDto> {
    return this.withRemoteDocker(id, userId, (docker) =>
      pagedRemoteVolumes(docker, page, pageSize, q),
    );
  }

  async remoteConsoleServicesPaged(
    id: number,
    userId: number,
    page: number,
    pageSize: number,
    q: string,
  ): Promise<PaginatedServicesDto> {
    return this.withRemoteDocker(id, userId, (docker) =>
      pagedRemoteServices(docker, page, pageSize, q),
    );
  }

  async remoteConsoleContainerLogs(
    id: number,
    userId: number,
    containerId: string,
    tail: number,
  ): Promise<{ logs: string }> {
    const logs = await this.withRemoteDocker(id, userId, (docker) =>
      remoteContainerLogs(docker, decodeURIComponent(containerId), tail),
    );
    return { logs };
  }

  async remoteConsoleServiceLogs(
    id: number,
    userId: number,
    serviceId: string,
    tail: number,
  ): Promise<{ logs: string }> {
    const logs = await this.withRemoteDocker(id, userId, (docker) =>
      remoteServiceLogs(docker, decodeURIComponent(serviceId), tail),
    );
    return { logs };
  }

  async remoteConsoleRemoveContainer(
    id: number,
    userId: number,
    containerId: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    const cid = decodeURIComponent(containerId);
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteContainer(docker, cid, force),
    );
    this.logOrgRemoteDockerMutation(
      id,
      userId,
      'security.remote_docker.container_removed',
      `DELETE /api/remote-servers/${id}/console/containers/${encodeURIComponent(cid)}`,
      { containerId: cid.slice(0, 400), force },
    );
    return { success: true };
  }

  async remoteConsoleRemoveImage(
    id: number,
    userId: number,
    ref: string,
    force = false,
  ): Promise<{ success: boolean }> {
    const refDecoded = decodeURIComponent(ref);
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteImage(docker, refDecoded, { force }),
    );
    this.logOrgRemoteDockerMutation(
      id,
      userId,
      'security.remote_docker.image_removed',
      `DELETE /api/remote-servers/${id}/console/images`,
      { imageRef: refDecoded.slice(0, 400), force },
    );
    return { success: true };
  }

  async remoteConsoleRemoveVolume(
    id: number,
    userId: number,
    name: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    const vol = decodeURIComponent(name);
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteVolume(docker, vol, force),
    );
    this.logOrgRemoteDockerMutation(
      id,
      userId,
      'security.remote_docker.volume_removed',
      `DELETE /api/remote-servers/${id}/console/volumes/${encodeURIComponent(vol)}`,
      { volumeName: vol.slice(0, 400), force },
    );
    return { success: true };
  }

  async remoteConsoleRemoveNetwork(
    id: number,
    userId: number,
    networkId: string,
  ): Promise<{ success: boolean }> {
    const nid = decodeURIComponent(networkId);
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteNetwork(docker, nid),
    );
    this.logOrgRemoteDockerMutation(
      id,
      userId,
      'security.remote_docker.network_removed',
      `DELETE /api/remote-servers/${id}/console/networks/${encodeURIComponent(nid)}`,
      { networkId: nid.slice(0, 400) },
    );
    return { success: true };
  }

  async remoteConsoleRemoveService(
    id: number,
    userId: number,
    serviceId: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    const sid = decodeURIComponent(serviceId);
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteService(docker, sid, force),
    );
    this.logOrgRemoteDockerMutation(
      id,
      userId,
      'security.remote_docker.service_removed',
      `DELETE /api/remote-servers/${id}/console/services/${encodeURIComponent(sid)}`,
      { serviceId: sid.slice(0, 400), force },
    );
    return { success: true };
  }

  /** Validates SSH + remote Docker via Dockerode (GET /version over `docker system dial-stdio`). */
  async testConnection(
    id: number,
    userId: number,
  ): Promise<{ success: boolean; output: string }> {
    const rs = await this.findEntityOrFail(id, userId);
    await this.assertOrgServerDockerIfNeeded(rs, userId);
    if (rs.organizationId != null) {
      await this.organizationsService.assertMemberCanTestOrgRemoteServers(
        userId,
        rs.organizationId,
      );
    }
    let outcome: { success: boolean; output: string };
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const docker = this.createDockerodeForRemote(rs, pem);
      try {
        const v = await docker.version();
        const lines = [
          `Version: ${v.Version}`,
          `ApiVersion: ${v.ApiVersion}`,
          `Os: ${v.Os}`,
          `Arch: ${v.Arch}`,
          v.KernelVersion ? `KernelVersion: ${v.KernelVersion}` : '',
        ].filter((s) => s.length > 0);
        outcome = { success: true, output: lines.join('\n') };
      } finally {
        await this.flushPendingSshHostKeyFingerprint(rs.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcome = {
        success: false,
        output: humanizeRemoteTestError(msg, 'docker'),
      };
    }
    if (rs.organizationId != null) {
      void this.organizationsService
        .appendOrganizationAuditEvent(
          rs.organizationId,
          userId,
          'security.remote_server.connection_tested',
          {
            metadata: {
              endpoint: `POST /api/remote-servers/${id}/test`,
              mode: 'docker',
              success: outcome.success,
            },
          },
        )
        .catch(() => undefined);
    }
    return outcome;
  }

  /**
   * SSH-only: connect with ssh2 and run a tiny shell command (no Docker / Dockerode).
   * Use to verify key, host, port, and sshd before debugging remote Docker.
   */
  async testSshOnly(
    id: number,
    userId: number,
  ): Promise<{ success: boolean; output: string }> {
    const rs = await this.findEntityOrFail(id, userId);
    await this.assertOrgServerTerminalIfNeeded(rs, userId);
    if (rs.organizationId != null) {
      await this.organizationsService.assertMemberCanTestOrgRemoteServers(
        userId,
        rs.organizationId,
      );
    }
    let outcome: { success: boolean; output: string };
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const p = this.getSshConnectParams(rs, pem);
      const stdout = await this.execSshRemoteShell(
        rs,
        pem,
        "bash -lc 'uname -sn 2>/dev/null || uname -s'",
      );
      const uname = stdout.trim().replace(/\s+/g, ' ');
      const lines = [
        `Connected as ${p.username} to ${p.host}:${p.port}.`,
        uname ? `Remote reports: ${uname}.` : '',
      ].filter((s) => s.length > 0);
      outcome = { success: true, output: lines.join('\n') };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcome = {
        success: false,
        output: humanizeRemoteTestError(msg, 'ssh'),
      };
    }
    if (rs.organizationId != null) {
      void this.organizationsService
        .appendOrganizationAuditEvent(
          rs.organizationId,
          userId,
          'security.remote_server.connection_tested',
          {
            metadata: {
              endpoint: `POST /api/remote-servers/${id}/test-ssh`,
              mode: 'ssh',
              success: outcome.success,
            },
          },
        )
        .catch(() => undefined);
    }
    return outcome;
  }

  async runTerminalCommand(
    id: number,
    userId: number,
    command: string,
  ): Promise<{ success: boolean; output: string }> {
    const trimmed = command.trim();
    if (!trimmed) {
      throw new BadRequestException('Command is required.');
    }
    const rs = await this.findEntityOrFail(id, userId);
    const endpoint = `POST /api/remote-servers/${encodeURIComponent(String(id))}/terminal`;
    const preview = trimmed.slice(0, 240);
    const appendTerminalAudit = (metadata: Record<string, unknown>) => {
      if (rs.organizationId == null) return;
      void this.organizationsService
        .appendOrganizationAuditEvent(
          rs.organizationId,
          userId,
          'security.remote_terminal.exec',
          {
            metadata: {
              endpoint,
              remoteServerPublicId: rs.publicId ?? null,
              remoteServerName: rs.name,
              ...metadata,
            },
          },
        )
        .catch(() => undefined);
    };
    try {
      await this.assertOrgServerTerminalIfNeeded(rs, userId);
    } catch (e) {
      if (e instanceof HttpException) {
        const httpStatus = e.getStatus();
        if (httpStatus === 403 || httpStatus === 404) {
          appendTerminalAudit({ commandPreview: preview, httpStatus });
        }
      }
      throw e;
    }
    const logTerminal = (success: boolean) => {
      appendTerminalAudit({
        commandPreview: preview,
        success,
        httpStatus: 200,
      });
    };
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const r = await this.execSshBashScriptCollectOutput(
        rs,
        pem,
        `${trimmed}\n`,
      );
      const out = [r.stdout, r.stderr]
        .filter((s) => s && String(s).trim())
        .join('\n');
      logTerminal(true);
      return { success: true, output: out || '(no output)' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logTerminal(false);
      return { success: false, output: humanizeRemoteTestError(msg, 'ssh') };
    }
  }

  private async execSshRemoteShell(
    rs: RemoteServer,
    privateKeyPem: string,
    command: string,
  ): Promise<string> {
    const client = new Client();
    const opts = this.getSsh2ConnectOptions(rs, privateKeyPem, 60_000);
    return new Promise((resolve, reject) => {
      client
        .once('ready', () => {
          void this.flushPendingSshHostKeyFingerprint(rs.id).then(() => {
            client.exec(command, (err, stream) => {
              if (err) {
                reject(err);
                return;
              }
              let stdout = '';
              let stderr = '';
              stream.on('close', (code: number) => {
                client.end();
                if (code === 0) {
                  resolve(stdout);
                } else {
                  reject(
                    new BadRequestException(
                      stderr.trim()
                        ? `SSH remote command failed (exit ${code}): ${stderr.trim().slice(0, 2000)}`
                        : `SSH remote command exited with code ${code}`,
                    ),
                  );
                }
              });
              stream.on('data', (d: Buffer) => {
                stdout += d.toString();
              });
              stream.stderr.on('data', (d: Buffer) => {
                stderr += d.toString();
              });
            });
          });
        })
        .on('error', (err: Error & { level?: string }) => {
          this.clearPendingSshHostKeyForServer(rs.id);
          try {
            client.end();
          } catch {
            /* ignore */
          }
          if (err.level === 'client-authentication') {
            reject(
              new BadRequestException(
                'SSH authentication failed — check the private key matches authorized_keys on the server.',
              ),
            );
          } else {
            reject(err);
          }
        })
        .connect(opts);
    });
  }

  private async withSshClient<T>(
    rs: RemoteServer,
    privateKeyPem: string,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client();
    const opts = this.getSsh2ConnectOptions(rs, privateKeyPem, 120_000);
    return await new Promise<T>((resolve, reject) => {
      client
        .once('ready', () => {
          void this.flushPendingSshHostKeyFingerprint(rs.id)
            .then(() => fn(client))
            .then((v) => {
              try {
                client.end();
              } catch {
                /* ignore */
              }
              resolve(v);
            })
            .catch((e) => {
              try {
                client.end();
              } catch {
                /* ignore */
              }
              reject(e);
            });
        })
        .on('error', (err: Error & { level?: string }) => {
          this.clearPendingSshHostKeyForServer(rs.id);
          try {
            client.end();
          } catch {
            /* ignore */
          }
          if (err.level === 'client-authentication') {
            reject(
              new BadRequestException(
                'SSH authentication failed — check the private key matches authorized_keys on the server.',
              ),
            );
          } else {
            reject(err);
          }
        })
        .connect(opts);
    });
  }

  private async execSshBashScriptCollectOutput(
    rs: RemoteServer,
    privateKeyPem: string,
    script: string,
    onChunk?: (s: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    return await this.withSshClient(rs, privateKeyPem, (client) =>
      this.execSshBashScriptCollectOutputOnClient(client, script, onChunk),
    );
  }

  private async execSshBashScriptCollectOutputOnClient(
    client: Client,
    script: string,
    onChunk?: (s: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      client.exec('bash -s', (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            const stderrSafe = stderr.trim().slice(0, 4000);
            const stdoutSafe = stdout.trim().slice(0, 4000);
            this.logger.error(
              `Remote command failed (exit=${code}) in execSshBashScriptCollectOutputOnClient.`,
              stderrSafe || stdoutSafe || '(no stderr/stdout)',
            );
            const detail = stderrSafe || stdoutSafe || `exit code ${code}`;
            reject(new BadRequestException(`Remote command failed: ${detail}`));
          }
        });
        stream.on('data', (d: Buffer) => {
          const s = d.toString();
          stdout += s;
          onChunk?.(s);
        });
        stream.stderr.on('data', (d: Buffer) => {
          const s = d.toString();
          stderr += s;
          onChunk?.(s);
        });
        stream.write(script);
        stream.end();
      });
    });
  }

  private async sshExecCollectOutput(
    client: Client,
    command: string,
    onChunk?: (s: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            const stderrSafe = stderr.trim().slice(0, 2000);
            this.logger.error(
              `Remote command failed (exit=${code}) in sshExecCollectOutput.`,
              stderrSafe || '(no stderr)',
            );
            reject(
              new InternalServerErrorException('Remote command failed'),
            );
          }
        });
        stream.on('data', (d: Buffer) => {
          const s = d.toString();
          stdout += s;
          onChunk?.(s);
        });
        stream.stderr.on('data', (d: Buffer) => {
          const s = d.toString();
          stderr += s;
          onChunk?.(s);
        });
      });
    });
  }

  private async sshExecIgnoreFailure(
    client: Client,
    command: string,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      client.exec(command, (err, stream) => {
        if (err) {
          resolve();
          return;
        }
        stream.on('close', () => resolve());
        stream.resume();
        stream.stderr?.resume();
      });
    });
  }

  private async execSshBashScriptCollectOutputBinaryStdoutOnClient(
    client: Client,
    script: string,
  ): Promise<{ stdout: Buffer; stderr: string }> {
    return await new Promise((resolve, reject) => {
      client.exec('bash -s', (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        const stdoutChunks: Buffer[] = [];
        let stderr = '';
        stream.on('close', (code: number) => {
          if (code === 0) {
            resolve({
              stdout: stdoutChunks.length
                ? Buffer.concat(stdoutChunks)
                : Buffer.alloc(0),
              stderr,
            });
          } else {
            const stderrSafe = stderr.trim().slice(0, 4000);
            this.logger.error(
              `Remote command failed (exit=${code}) in execSshBashScriptCollectOutputBinaryStdoutOnClient.`,
              stderrSafe || '(no stderr)',
            );
            reject(
              new InternalServerErrorException('Remote command failed'),
            );
          }
        });
        stream.on('data', (d: Buffer) => {
          stdoutChunks.push(Buffer.from(d));
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        stream.write(script);
        stream.end();
      });
    });
  }

  private async sftpReadRemoteBuffer(
    client: Client,
    remotePath: string,
  ): Promise<Buffer> {
    return await new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        const chunks: Buffer[] = [];
        const rs = sftp.createReadStream(remotePath);
        rs.on('data', (d: Buffer) => chunks.push(Buffer.from(d)));
        rs.on('error', (e) => {
          try {
            sftp.end();
          } catch {
            /* ignore */
          }
          reject(e);
        });
        rs.on('end', () => {
          try {
            sftp.end();
          } catch {
            /* ignore */
          }
          resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0));
        });
      });
    });
  }

  private async sftpWriteRemoteFile(
    client: Client,
    remotePath: string,
    content: string,
  ): Promise<void> {
    return await this.sftpWriteRemoteBuffer(
      client,
      remotePath,
      Buffer.from(content, 'utf8'),
    );
  }

  private async sftpWriteRemoteBuffer(
    client: Client,
    remotePath: string,
    buf: Buffer,
  ): Promise<void> {
    return await new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        const ws = sftp.createWriteStream(remotePath);
        ws.on('error', (e) => {
          try {
            sftp.end();
          } catch {
            /* ignore */
          }
          reject(e);
        });
        ws.on('close', () => {
          try {
            sftp.end();
          } catch {
            /* ignore */
          }
          resolve();
        });
        ws.end(buf);
      });
    });
  }

  /**
   * Ed25519 key pair via Node.js `crypto` — OpenSSH `openssh-key-v1` PEM + `.pub` style line (same as ssh-keygen).
   */
  generateSshKeyPair(): { privateKey: string; publicKey: string } {
    try {
      return generateEd25519SshKeyPair();
    } catch (e) {
      this.logger.error(
        'SSH key generation failed.',
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Could not generate SSH keys',
      );
    }
  }
}
