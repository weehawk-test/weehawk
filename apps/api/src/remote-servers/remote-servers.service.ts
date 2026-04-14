import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import Dockerode from 'dockerode';
import { Client, type ClientChannel } from 'ssh2';
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
  remoteInstallShQuote,
  REMOTE_NOTIFY_DEFAULTS_WEBHOOK,
} from '../common/remote-wrapped-script-install';
import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik/traefik.constants';
import { TraefikService } from '../traefik/traefik.service';
import { WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE } from './weehawk-webhook-agent.constants';
import type { WebhookAgentProvisionInput } from './remote-server-provision.script';
import { toSafePathSegment } from '../services/deployment-paths';
import { isLoopbackSshHost } from './loopback-ssh-host';

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
        : 'The connection closed unexpectedly during SSH. Typical causes: wrong host or port; firewall or security group blocking port 22 (or your custom port); sshd not running; or an unstable network between the Weehawk API and the server.') + tech
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
        : 'SSH connection timed out. Check the host is reachable from the machine running the Weehawk API, DNS resolves, and the SSH port is open.') + tech
    );
  }

  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return (
      (mode === 'docker'
        ? 'Nothing accepted the connection on that host:port (connection refused). Confirm the SSH port and that sshd is listening.'
        : 'Connection refused — no service accepted TCP on that host:port. Verify the SSH port and that sshd is running.') + tech
    );
  }

  if (
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('name or service not known')
  ) {
    return (
      `Host name could not be resolved (DNS or invalid hostname). Check the host string.${tech}`
    );
  }

  if (
    lower.includes('authentication') ||
    lower.includes('all configured authentication methods failed') ||
    lower.includes('permission denied (publickey')
  ) {
    return (
      (mode === 'docker'
        ? 'SSH authentication failed before Docker could be reached. Ensure this server’s public key is in ~/.ssh/authorized_keys for the SSH user, and the private key in Weehawk matches.'
        : 'SSH authentication failed. Ensure the public key is in ~/.ssh/authorized_keys on the server for this user, and the private key stored in Weehawk is the matching pair.') + tech
    );
  }

  return t.length > 0 ? t : 'Unknown error';
}

/** Bash scripts for webhooks are uploaded here for the on-host Go webhook agent. */
export const WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR = '/opt/weehawk-scripts/webhooks';

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

/** Traefik rule fragment: `Host(\`a\`) || Host(\`b\`)` */
function buildTraefikHostRuleForWebhookAgent(hosts: string[]): string {
  const n = normalizeHooksPublicHosts(hosts);
  if (n.length === 0) return '';
  return n.map((h) => `Host(\`${h.replace(/`/g, '')}\`)`).join(' || ');
}

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
  /** Public IPv4 for Magic Traefik.me hostnames (optional). */
  publicIpv4: string | null;
  /** Optional JSON: domain labels / metadata (primarily for deploy servers). */
  domainsJson: string | null;
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

@Injectable()
export class RemoteServersService implements OnApplicationBootstrap {
  /**
   * Serialize Swarm webhook-agent deploys per remote server so concurrent API calls
   * do not race on `docker service rm` / `docker service create` (AlreadyExists).
   */
  private readonly webhookSwarmRecreateChainByServerId = new Map<number, Promise<void>>();

  constructor(
    @InjectRepository(RemoteServer)
    private readonly remoteServerRepository: Repository<RemoteServer>,
    private readonly configService: ConfigService,
    private readonly traefikService: TraefikService,
  ) {}

  /** Fix legacy rows: loopback SSH hosts are build-only, never deploy. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const svcRepo =
        this.remoteServerRepository.manager.getRepository(Service);
      const rows = await this.remoteServerRepository.find();
      for (const r of rows) {
        if (isLoopbackSshHost(r.host) && r.serverRole === 'deploy') {
          const n = await svcRepo.count({
            where: { remoteServer: { id: r.id } },
          });
          if (n === 0) {
            r.serverRole = 'build';
            await this.remoteServerRepository.save(r);
          }
        }
      }
    } catch {
      /* ignore if DB not ready */
    }
  }

  private runWebhookSwarmOpSerialized(
    remoteServerId: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    const prev = this.webhookSwarmRecreateChainByServerId.get(remoteServerId) ?? Promise.resolve();
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
   * Ensures a remote host used at deploy/build time belongs to the same account as the project.
   */
  assertRemoteServerMatchesProject(
    rs: RemoteServer | null | undefined,
    projectUserId: number | null,
  ): void {
    if (!rs) {
      throw new NotFoundException('Remote server not found');
    }
    if (projectUserId != null && rs.userId !== projectUserId) {
      throw new NotFoundException('Remote server not found');
    }
    return;
  }

  private async resolveProjectUserId(service: Service): Promise<number | null> {
    if (service.project?.userId != null) return service.project.userId;
    const projectId =
      typeof (service as Service & { projectId?: number }).projectId === 'number'
        ? (service as Service & { projectId?: number }).projectId
        : (service.project as { id?: number } | undefined)?.id;
    if (!projectId) return null;
    const project = await this.remoteServerRepository.manager.getRepository(Project).findOne({
      where: { id: projectId },
      select: { userId: true },
    });
    return project?.userId ?? null;
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
      serverRole:
        isLoopbackSshHost(rs.host) || rs.serverRole === 'build'
          ? 'build'
          : 'deploy',
      authMode,
      hasPrivateKey,
      privateKeyPath: hasPath ? rs.privateKeyPath! : null,
      extraSshOptions: rs.extraSshOptions ?? null,
      publicIpv4: rs.publicIpv4?.trim() ? rs.publicIpv4.trim() : null,
      domainsJson: rs.domainsJson?.trim() ? rs.domainsJson.trim() : null,
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
   * Shared ssh2 connect params for Dockerode and plain SSH checks (loopback → localhost + IPv4).
   */
  private getSshConnectParams(rs: RemoteServer, privateKeyPem: string): {
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
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    const script = `set -eu\n${bashScriptBody}`;
    return await this.execSshBashScriptCollectOutput(p, script, onChunk);
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
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
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
          client.exec('bash -s', (err, stream) => {
            if (err || !stream) {
              if (!settled) {
                settled = true;
                rejectOuter(
                  err ?? new InternalServerErrorException('SSH exec failed for remote docker logs'),
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
        })
        .on('error', (err: Error) => {
          if (!settled) {
            settled = true;
            rejectOuter(err);
          }
        })
        .connect({
          host: p.host,
          port: p.port,
          username: p.username,
          privateKey: p.privateKey,
          readyTimeout: 120_000,
          hostVerifier: () => true,
          ...(p.family != null ? { family: p.family } : {}),
        });
    });
  }

  /**
   * Public URL for the on-host webhook agent (e.g. Go) that runs
   * `{@link WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/{token}.sh`.
   * Env: `WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT` (default 8759),
   * `WEEHAWK_REMOTE_WEBHOOK_URL_PATH_PREFIX` (default `hooks` → path `/hooks/{token}`).
   * HTTP vs HTTPS for webhooks is set per webhook ({@code remoteTriggerUrlScheme}), not env.
   */
  /** HTTP port the on-host webhook agent must listen on (loopback health check + systemd unit). */
  resolveRemoteWebhookHttpPort(): number {
    const portRaw = this.configService.get<string>('WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT');
    const portNum =
      portRaw != null && String(portRaw).trim() !== ''
        ? Number(portRaw)
        : 8759;
    return Number.isFinite(portNum) && portNum > 0 ? portNum : 8759;
  }

  /** URL path segment before the secret token (must match weehawk-webhook-agent). */
  resolveRemoteWebhookPathPrefix(): string {
    let pathPrefix =
      this.configService.get<string>('WEEHAWK_REMOTE_WEBHOOK_URL_PATH_PREFIX')?.trim() || 'hooks';
    return pathPrefix.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Traefik entrypoints for the webhook Swarm service (comma-separated).
   * Default `web,websecure` matches deploy provision (:80 and :443).
   * The Swarm recreate emits **one Traefik router per entrypoint** so plain HTTP on `web` is not
   * forced to TLS (a single router with `entrypoints=web,websecure` and `tls=true` can redirect HTTP→HTTPS).
   */
  private resolveWeehawkWebhookAgentTraefikEntrypoints(): string {
    const raw = this.configService.get<string>('WEEHAWK_WEBHOOK_AGENT_TRAEFIK_ENTRYPOINTS')?.trim();
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
      hostRaw.includes(':') && !hostRaw.startsWith('[') ? `[${hostRaw}]` : hostRaw;
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
    return this.configService.get<string>('WEEHAWK_WEBHOOK_AGENT_IMAGE')?.trim() || null;
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
    const hasPublicHosts = normalizeHooksPublicHosts(hooksPublicHosts).length > 0;

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
      const image = await this.buildBundledWebhookAgentImageOnRemote(remoteServerId, projectUserId);
      await this.recreateWeehawkWebhookSwarmService(
        remoteServerId,
        projectUserId,
        image,
        hooksPublicHosts,
        { pullImage: false },
      );
      return;
    }

    if (await this.remoteSwarmWebhookAgentServiceExists(remoteServerId, projectUserId)) {
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
      await this.execDockerCliOnRemoteViaSsh(remoteServerId, projectUserId, body);
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
    await this.runWebhookSwarmOpSerialized(remoteServerId, () =>
      this.recreateWeehawkWebhookSwarmServiceUnlocked(
        remoteServerId,
        projectUserId,
        image,
        hooksPublicHosts,
        options,
      ),
    );
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
    const rule = buildTraefikHostRuleForWebhookAgent(hostsNorm);
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

    const traefikSettings = rule ? await this.traefikService.getSettings() : null;
    const certResolverName = (traefikSettings?.certResolverName || 'letsencrypt').trim();

    const labelsPart = rule
      ? (() => {
          const base = [
            `--label ${shSingleQuoteRemote('traefik.enable=true')}`,
            `--label ${shSingleQuoteRemote(`traefik.docker.network=${net}`)}`,
            `--label ${shSingleQuoteRemote(`traefik.http.services.weehawkhooks.loadbalancer.server.port=${port}`)}`,
            `--label ${shSingleQuoteRemote('traefik.http.services.weehawkhooks.loadbalancer.passhostheader=true')}`,
          ];
          const routerLabels: string[] = [];
          for (const ep of entrypointsList.length ? entrypointsList : ['web', 'websecure']) {
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
      await this.execDockerCliOnRemoteViaSsh(remoteServerId, projectUserId, body);
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

    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
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

    await this.withSshClient(p, async (client) => {
      await this.sshExecCollectOutput(client, `mkdir -p '${dirQ}'`);
      await this.sftpWriteRemoteBuffer(client, `${remoteDir}/Dockerfile`, dockerfile);
      await this.sftpWriteRemoteBuffer(client, `${remoteDir}/main.go`, mainGo);
      await this.sftpWriteRemoteBuffer(client, `${remoteDir}/go.mod`, goMod);
      await this.execSshBashScriptCollectOutputOnClient(client, body, undefined);
    });

    return tag;
  }

  /**
   * True when loopback `http://127.0.0.1:{port}/healthz` responds (weehawk-webhook-agent).
   */
  async isRemoteWebhookAgentHealthy(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<boolean> {
    const port = this.resolveRemoteWebhookHttpPort();
    const body = `
if command -v curl >/dev/null 2>&1; then
  curl -sf --max-time 6 "http://127.0.0.1:${port}/healthz" >/dev/null
  exit 0
fi
if command -v wget >/dev/null 2>&1; then
  wget -q -T 6 -O /dev/null "http://127.0.0.1:${port}/healthz"
  exit 0
fi
exit 1
`;
    try {
      await this.execDockerCliOnRemoteViaSsh(remoteServerId, projectUserId, body);
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
    const v = this.configService.get<string>('WEEHAWK_REMOTE_GO_INSTALL_VERSION')?.trim();
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
    const s = this.configService.get<string>('WEEHAWK_REMOTE_GO_AUTO_INSTALL')?.trim().toLowerCase();
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
    const downloadUrl = this.configService.get<string>('WEEHAWK_WEBHOOK_AGENT_DOWNLOAD_URL')?.trim();
    const localBinary = this.configService.get<string>('WEEHAWK_WEBHOOK_AGENT_BINARY')?.trim();
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
        if (await this.isRemoteWebhookAgentHealthy(remoteServerId, projectUserId)) {
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
        if (await this.isRemoteWebhookAgentHealthy(remoteServerId, projectUserId)) {
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
        if (await this.isRemoteWebhookAgentHealthy(remoteServerId, projectUserId)) {
          return;
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }

    const port = this.resolveRemoteWebhookHttpPort();
    throw new BadRequestException(
      (lastErr ? `${lastErr}\n\n` : '') +
        `Remote server has no webhook agent on http://127.0.0.1:${port}/healthz. ` +
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
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
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

    await this.withSshClient(p, async (client) => {
      await this.sshExecCollectOutput(client, `mkdir -p '${srcQ}'`);
      await this.sftpWriteRemoteBuffer(client, `${remoteSrc}/main.go`, mainGo);
      await this.sftpWriteRemoteBuffer(client, `${remoteSrc}/go.mod`, goMod);
      await this.execSshBashScriptCollectOutputOnClient(client, body, undefined);
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
      throw new BadRequestException('WEEHAWK_WEBHOOK_AGENT_BINARY must be an absolute path.');
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
      throw new BadRequestException('WEEHAWK_WEBHOOK_AGENT_BINARY file is too small to be a valid binary.');
    }
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
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
    await this.withSshClient(p, async (client) => {
      await this.sftpWriteRemoteBuffer(client, remoteTmp, buf);
      await this.sshExecCollectOutput(client, `chmod 700 '${tmpQ}'`);
      await this.execSshBashScriptCollectOutputOnClient(client, body, undefined);
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
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    const envPath = `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.env`;
    const scriptPath = `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.sh`;
    const installScript = buildRemoteEnvAndWrappedShInstallScript({
      parentDirShQuoted: remoteInstallShQuote(WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR),
      envPath,
      scriptPath,
      envLines: notificationEnvLines,
      userScriptBody: scriptBody,
      defaults: REMOTE_NOTIFY_DEFAULTS_WEBHOOK,
    });
    const deployBaseQ = WEEHAWK_REMOTE_DEPLOYMENTS_BASE.replace(/'/g, `'\\''`);
    await this.withSshClient(p, async (client) => {
      await this.sshExecIgnoreFailure(client, `mkdir -p '${deployBaseQ}'`);
      await this.execSshBashScriptCollectOutputOnClient(client, installScript, undefined);
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
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      return;
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    const shQ = `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.sh`.replace(
      /'/g,
      `'\\''`,
    );
    const envQ = `${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${scriptToken}.env`.replace(
      /'/g,
      `'\\''`,
    );
    await this.withSshClient(p, async (client) => {
      await this.sshExecIgnoreFailure(client, `rm -f '${shQ}' '${envQ}'`);
    });
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
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    const remoteDir = `/tmp/weehawk_sd_${randomBytes(12).toString('hex')}`;
    const stackQ = params.stackName.replace(/'/g, `'\\''`);

    let configJson: string | undefined;
    if (params.localDockerConfigDir?.trim()) {
      const cfgPath = path.join(params.localDockerConfigDir.trim(), 'config.json');
      try {
        configJson = await fs.readFile(cfgPath, 'utf8');
      } catch {
        configJson = undefined;
      }
    }

    const onChunk = params.onChunk;
    return await this.withSshClient(p, async (client) => {
      try {
        await this.sshExecCollectOutput(client, `mkdir -p '${remoteDir}/docker-config'`, onChunk);
        onChunk?.('Uploading compose to remote host…\n');
        await this.sftpWriteRemoteFile(client, `${remoteDir}/docker-compose.yml`, params.composeYaml);
        if (configJson != null) {
          await this.sftpWriteRemoteFile(client, `${remoteDir}/docker-config/config.json`, configJson);
        }
        const envExports = bashExportBlockForStackDeploy(params.deployEnv ?? {});
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
    await this.execSshBashScriptCollectOutputOnClient(client, mirrorScript, onChunk);
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
    params: { localComposeAbsolutePath: string; projectName: string },
  ): Promise<void> {
    const yaml = await fs.readFile(params.localComposeAbsolutePath, 'utf8');
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(params.projectName)}`;
    const remoteYml = `${persist}/docker-compose.yml`;
    const persistQ = persist.replace(/'/g, `'\\''`);
    await this.withSshClient(p, async (client) => {
      await this.sshExecCollectOutput(client, `mkdir -p '${persistQ}'`, undefined);
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
    const rs = await this.remoteServerRepository.findOne({
      where: { id: remoteServerId },
    });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(params.stackName)}`;
    const persistQ = persist.replace(/'/g, `'\\''`);

    let configJson: string | undefined;
    if (params.localDockerConfigDir?.trim()) {
      const cfgPath = path.join(params.localDockerConfigDir.trim(), 'config.json');
      try {
        configJson = await fs.readFile(cfgPath, 'utf8');
      } catch {
        configJson = undefined;
      }
    }

    await this.withSshClient(p, async (client) => {
      await this.sshExecCollectOutput(client, `mkdir -p '${persistQ}'`, undefined);
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
  private async listRelativeFilePathsForDeploymentMirror(localRootAbs: string): Promise<string[]> {
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
        throw new BadRequestException(`Local mirror path is not a directory: ${localRoot}`);
      }
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      throw new BadRequestException(`Local mirror path not found: ${localRoot}`);
    }
    const files = await this.listRelativeFilePathsForDeploymentMirror(localRoot);
    if (files.length === 0) {
      return;
    }
    const rs = await this.remoteServerRepository.findOne({
      where: { id: remoteServerId },
    });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    const remoteDir = params.remoteDirAbsolute.replace(/\\/g, '/').replace(/\/+$/, '');

    await this.withSshClient(p, async (client) => {
      const rdq = remoteDir.replace(/'/g, `'\\''`);
      await this.sshExecCollectOutput(client, `rm -rf '${rdq}' && mkdir -p '${rdq}'`, undefined);
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
    const r = await this.execDockerCliOnRemoteViaSsh(remoteServerId, projectUserId, body, onChunk);
    return { output: [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n'), stderr: r.stderr };
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
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    return await this.withSshClient(p, async (client) => {
      const exists = await this.sshExecExitCode(client, `docker secret inspect ${JSON.stringify(secretName)} >/dev/null 2>&1`);
      if (exists === 0) {
        return;
      }
      await this.sshExecDockerSecretCreateStdin(client, secretName, secretValue);
    });
  }

  /** Returns process exit code (0–255). */
  private async sshExecExitCode(client: Client, command: string): Promise<number> {
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
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        stream.on('close', (code: number) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new InternalServerErrorException(
                stderr.trim()
                  ? `Remote docker secret create failed: ${stderr.trim().slice(0, 2000)}`
                  : `Remote docker secret create failed (exit ${code})`,
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
  private createDockerodeForRemote(rs: RemoteServer, privateKeyPem: string): Dockerode {
    const p = this.getSshConnectParams(rs, privateKeyPem);
    return new Dockerode({
      host: p.host,
      port: p.port,
      username: p.username,
      protocol: 'ssh',
      sshOptions: {
        privateKey: p.privateKey,
        readyTimeout: 60_000,
        // Match non-interactive “first connect” UX; Swarm deploy uses SSH exec on the remote host instead of local DOCKER_HOST=ssh:// when a deploy server is set.
        hostVerifier: () => true,
        ...(p.family != null ? { family: p.family } : {}),
      },
    });
  }

  /**
   * Docker CLI uses DOCKER_HOST=ssh://user@host[:port] and DOCKER_SSH_OPTS for identity / options.
   * Swarm stack deploy / stack ops when `remoteServerId` is set are implemented via {@link stackDeployViaSsh}
   * and {@link execDockerCliOnRemoteViaSsh} so the API host does not rely on `docker` + dial-stdio (e.g. Windows).
   */
  async dockerHostEnvForServer(rs: RemoteServer): Promise<Record<string, string>> {
    const identityPath = await this.resolveIdentityFilePath(rs);
    const raw = rs.host.trim();
    const isLoopback = isLoopbackSshHost(raw);
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
    const projectUserId = await this.resolveProjectUserId(service);
    const rs = await this.remoteServerRepository.findOne({ where: { id } });
    if (!rs) {
      return base;
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
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
    return this.mergeDockerHostEnvForBuildIds(
      base,
      {
        buildRemoteServerId:
          service.buildRemoteServerId ?? service.buildRemoteServer?.id ?? null,
        remoteServerId: service.remoteServerId ?? service.remoteServer?.id ?? null,
        buildOnLocalDockerHost: service.buildOnLocalDockerHost === true,
      },
      await this.resolveProjectUserId(service),
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
  ): Promise<NodeJS.ProcessEnv> {
    const toCheck = new Set<number>();
    if (ids.remoteServerId != null) toCheck.add(ids.remoteServerId);
    if (ids.buildRemoteServerId != null) toCheck.add(ids.buildRemoteServerId);
    for (const rid of toCheck) {
      const row = await this.remoteServerRepository.findOne({ where: { id: rid } });
      this.assertRemoteServerMatchesProject(row, projectUserId);
    }
    if (ids.buildOnLocalDockerHost === true) {
      return base;
    }
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
    projectUserId: number | null,
  ): Promise<NodeJS.ProcessEnv> {
    if (remoteServerId == null) {
      return base;
    }
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      return base;
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
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

  async findAll(userId: number): Promise<RemoteServerSafe[]> {
    const rows = await this.remoteServerRepository.find({
      where: { userId },
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.toSafe(r));
  }

  async findOne(id: number, userId: number): Promise<RemoteServerSafe> {
    const rs = await this.findEntityOrFail(id, userId);
    return this.toSafe(rs);
  }

  async assertDeployServerById(
    id: number,
    projectUserId: number | null,
  ): Promise<void> {
    const rs = await this.remoteServerRepository.findOne({ where: { id } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${id} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
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
  }

  /**
   * For SSH provision worker: load row + decrypted PEM after ownership check.
   */
  async getSshProvisionContext(
    id: number,
    userId: number,
  ): Promise<{ server: RemoteServer; privateKeyPem: string }> {
    const server = await this.findEntityOrFail(id, userId);
    const privateKeyPem = await this.resolvePrivateKeyPem(server);
    return { server, privateKeyPem };
  }

  /** For WebSocket remote terminal. */
  async getSshTerminalContext(id: number): Promise<{
    connect: {
      host: string;
      port: number;
      username: string;
      privateKey: Buffer;
      family?: number;
    };
  }> {
    const rs = await this.remoteServerRepository.findOne({ where: { id } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${id} not found`);
    }
    const pem = await this.resolvePrivateKeyPem(rs);
    const p = this.getSshConnectParams(rs, pem);
    return { connect: p };
  }

  private async findEntityOrFail(id: number, userId: number): Promise<RemoteServer> {
    const rs = await this.remoteServerRepository.findOne({ where: { id, userId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${id} not found`);
    }
    return rs;
  }

  async create(dto: CreateRemoteServerDto, userId: number): Promise<RemoteServerSafe> {
    const pem = dto.privateKey.trim();
    const privateKeyEncrypted = encryptPrivateKey(pem, this.getEncryptionSecret());

    const hostTrimmed = dto.host.trim();
    const serverRole: 'deploy' | 'build' = isLoopbackSshHost(hostTrimmed)
      ? 'build'
      : dto.serverRole === 'build'
        ? 'build'
        : 'deploy';

    const entity = this.remoteServerRepository.create({
      userId,
      name: dto.name.trim(),
      host: hostTrimmed,
      port: dto.port ?? 22,
      sshUser: dto.sshUser.trim(),
      serverRole,
      privateKeyEncrypted,
      privateKeyPath: null,
      extraSshOptions: dto.extraSshOptions?.trim() || null,
      publicIpv4: dto.publicIpv4?.trim() ? dto.publicIpv4.trim() : null,
      domainsJson:
        dto.domainsJson !== undefined && String(dto.domainsJson).trim()
          ? normalizeDomainsJsonInput(String(dto.domainsJson))
          : null,
    });
    const saved = await this.remoteServerRepository.save(entity);
    return this.toSafe(saved);
  }

  async update(
    id: number,
    dto: UpdateRemoteServerDto,
    userId: number,
  ): Promise<RemoteServerSafe> {
    const existing = await this.findEntityOrFail(id, userId);
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
      publicIpv4:
        dto.publicIpv4 === undefined
          ? existing.publicIpv4
          : dto.publicIpv4 != null && String(dto.publicIpv4).trim()
            ? String(dto.publicIpv4).trim()
            : null,
      domainsJson:
        dto.domainsJson === undefined
          ? existing.domainsJson ?? null
          : normalizeDomainsJsonInput(
              dto.domainsJson == null ? undefined : String(dto.domainsJson),
            ),
      privateKeyEncrypted: nextEnc,
      privateKeyPath: nextPath,
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
      merged.serverRole = 'build';
    }
    const saved = await this.remoteServerRepository.save(merged);
    return this.toSafe(saved);
  }

  async remove(id: number, userId: number): Promise<void> {
    await this.findEntityOrFail(id, userId);
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
    userId: number,
    fn: (docker: Dockerode) => Promise<T>,
  ): Promise<T> {
    const rs = await this.findEntityOrFail(id, userId);
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
    projectUserId: number | null,
  ): Promise<{ output: string }> {
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
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
    projectUserId: number | null,
  ): Promise<{ output: string }> {
    const rs = await this.remoteServerRepository.findOne({ where: { id: remoteServerId } });
    if (!rs) {
      throw new NotFoundException(`Remote server #${remoteServerId} not found`);
    }
    this.assertRemoteServerMatchesProject(rs, projectUserId);
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
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteContainer(docker, decodeURIComponent(containerId), force),
    );
    return { success: true };
  }

  async remoteConsoleRemoveImage(
    id: number,
    userId: number,
    ref: string,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteImage(docker, decodeURIComponent(ref)),
    );
    return { success: true };
  }

  async remoteConsoleRemoveVolume(
    id: number,
    userId: number,
    name: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteVolume(docker, decodeURIComponent(name), force),
    );
    return { success: true };
  }

  async remoteConsoleRemoveNetwork(
    id: number,
    userId: number,
    networkId: string,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteNetwork(docker, decodeURIComponent(networkId)),
    );
    return { success: true };
  }

  async remoteConsoleRemoveService(
    id: number,
    userId: number,
    serviceId: string,
    force: boolean,
  ): Promise<{ success: boolean }> {
    await this.withRemoteDocker(id, userId, (docker) =>
      removeRemoteService(docker, decodeURIComponent(serviceId), force),
    );
    return { success: true };
  }

  /** Validates SSH + remote Docker via Dockerode (GET /version over `docker system dial-stdio`). */
  async testConnection(
    id: number,
    userId: number,
  ): Promise<{ success: boolean; output: string }> {
    const rs = await this.findEntityOrFail(id, userId);
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
      return { success: false, output: humanizeRemoteTestError(msg, 'docker') };
    }
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
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const p = this.getSshConnectParams(rs, pem);
      const stdout = await this.execSshRemoteShell(p, "bash -lc 'uname -sn 2>/dev/null || uname -s'");
      const uname = stdout.trim().replace(/\s+/g, ' ');
      const lines = [
        `Connected as ${p.username} to ${p.host}:${p.port}.`,
        uname ? `Remote reports: ${uname}.` : '',
      ].filter((s) => s.length > 0);
      return { success: true, output: lines.join('\n') };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: humanizeRemoteTestError(msg, 'ssh') };
    }
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
    try {
      const pem = await this.resolvePrivateKeyPem(rs);
      const p = this.getSshConnectParams(rs, pem);
      const r = await this.execSshBashScriptCollectOutput(p, `${trimmed}\n`);
      const out = [r.stdout, r.stderr]
        .filter((s) => s && String(s).trim())
        .join('\n');
      return { success: true, output: out || '(no output)' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: humanizeRemoteTestError(msg, 'ssh') };
    }
  }

  private async execSshRemoteShell(
    p: {
      host: string;
      port: number;
      username: string;
      privateKey: Buffer;
      family?: number;
    },
    command: string,
  ): Promise<string> {
    const client = new Client();
    return new Promise((resolve, reject) => {
      client
        .once('ready', () => {
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
        })
        .on('error', (err: Error & { level?: string }) => {
          client.end();
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
        .connect({
          host: p.host,
          port: p.port,
          username: p.username,
          privateKey: p.privateKey,
          readyTimeout: 60_000,
          hostVerifier: () => true,
          ...(p.family != null ? { family: p.family } : {}),
        });
    });
  }

  private async withSshClient<T>(
    p: {
      host: string;
      port: number;
      username: string;
      privateKey: Buffer;
      family?: number;
    },
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client();
    return await new Promise<T>((resolve, reject) => {
      client
        .once('ready', () => {
          void fn(client)
            .then((v) => {
              client.end();
              resolve(v);
            })
            .catch((e) => {
              client.end();
              reject(e);
            });
        })
        .on('error', (err: Error & { level?: string }) => {
          client.end();
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
        .connect({
          host: p.host,
          port: p.port,
          username: p.username,
          privateKey: p.privateKey,
          readyTimeout: 120_000,
          hostVerifier: () => true,
          ...(p.family != null ? { family: p.family } : {}),
        });
    });
  }

  private async execSshBashScriptCollectOutput(
    p: {
      host: string;
      port: number;
      username: string;
      privateKey: Buffer;
      family?: number;
    },
    script: string,
    onChunk?: (s: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    return await this.withSshClient(p, (client) =>
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
            reject(
              new InternalServerErrorException(
                stderr.trim()
                  ? `Remote command failed (exit ${code}): ${stderr.trim().slice(0, 4000)}`
                  : `Remote command exited with code ${code}`,
              ),
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
            reject(
              new InternalServerErrorException(
                stderr.trim()
                  ? `Remote command failed (exit ${code}): ${stderr.trim().slice(0, 2000)}`
                  : `Remote command exited with code ${code}`,
              ),
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

  private async sshExecIgnoreFailure(client: Client, command: string): Promise<void> {
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

  private async sftpWriteRemoteFile(
    client: Client,
    remotePath: string,
    content: string,
  ): Promise<void> {
    return await this.sftpWriteRemoteBuffer(client, remotePath, Buffer.from(content, 'utf8'));
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
