import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  forwardRef,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './entities/service.entity';
import { RemoteServer } from '../remote-servers/entities/remote-server.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { Project } from 'src/projects/entities/project.entity';
import { randomBytes } from 'crypto';
import * as os from 'os';
import { ExecutorService } from '../executor/executor.service';
import { emitDeployLog } from '../executor/executor-docker';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { Observable } from 'rxjs';
import { composeType } from './entities/composeType.enum';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fss from 'fs';
import {
  DatabaseEngine,
  DatabaseGeneratorService,
} from './database-generator.service';
import { DatabaseSetupDto } from './dto/database-setup.dto';
import { PostgresStackUpdateDto } from './dto/postgres-stack-update.dto';
import { DockerSecretsService } from 'src/dockersecrets/dockersecrets.service';
import * as unzipper from 'unzipper';
import {
  createBackupTempDir,
  getServiceDeploymentDir,
  removeBackupTempDir,
  toSafePathSegment,
} from './deployment-paths';
import type { EventEmitter } from 'events';
import { DockerfileGeneratorService } from '../dockerfile-generator/dockerfile-generator.service';
import type { DatabaseBackupConfig } from '../backup/database-backup.types';
import { resolveBackupFormat } from '../backup/database-backup.types';
import { RunServiceBackupDto } from './dto/run-service-backup.dto';
import { ImportServiceBackupFromS3Dto } from './dto/import-service-backup-from-s3.dto';
import { S3Service } from '../s3/s3.service';
import { getErrorMessage } from '../utils/error-message';
import { GitService } from '../git/git.service';
import { TraefikService } from '../traefik/traefik.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik/traefik.constants';
import {
  buildTraefikMeMagicHostname,
  parseIpv4Octets,
} from '../common/magic-traefik-me';
import { isLoopbackSshHost } from '../remote-servers/loopback-ssh-host';
import {
  RemoteServersService,
  WEEHAWK_REMOTE_DEPLOYMENTS_BASE,
} from '../remote-servers/remote-servers.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class ServicesService {
  private readonly log = new Logger(ServicesService.name);

  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(RemoteServer)
    private readonly remoteServerRepository: Repository<RemoteServer>,
    @Inject(forwardRef(() => ExecutorService))
    private readonly executorService: ExecutorService,
    @Inject(forwardRef(() => WebhooksService))
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
    private readonly databaseGenerator: DatabaseGeneratorService,
    private readonly dockerfileGenerator: DockerfileGeneratorService,
    private readonly dockerSecrets: DockerSecretsService,
    private readonly s3Service: S3Service,
    private readonly gitService: GitService,
    private readonly traefikService: TraefikService,
    private readonly remoteServersService: RemoteServersService,
  ) {}

  /** Ensures the service exists. */
  async assertServiceOwnedByUser(
    serviceId: number,
    userId: number,
  ): Promise<Service> {
    const service = await this.serviceRepository.findOne({
      where: { id: serviceId, project: { userId } },
      relations: ['project', 'remoteServer', 'buildRemoteServer'],
    });
    if (!service) {
      throw new NotFoundException(`Service #${serviceId} not found`);
    }
    return service;
  }

  private async assertProjectOwnedByUser(
    projectId: number,
    userId: number,
  ): Promise<Project> {
    const project = await this.projectRepository.findOneBy({ id: projectId, userId });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  async create(createServiceDto: CreateServiceDto, userId: number) {
    const {
      projectId,
      appName,
      remoteServerId,
      buildRemoteServerId,
      registryPushImage: registryPushInCreate,
      ...serviceData
    } = createServiceDto;
    const project = await this.assertProjectOwnedByUser(projectId, userId);

    if (buildRemoteServerId != null && serviceData.buildOnLocalDockerHost === true) {
      throw new BadRequestException(
        'Cannot set a dedicated build host when building on this server (API). Clear build host or turn off “build on this server”.',
      );
    }

    if (remoteServerId != null) {
      await this.assertDeployRemoteServer(remoteServerId, null);
    }
    if (buildRemoteServerId != null) {
      await this.assertBuildRemoteServer(buildRemoteServerId, null);
    }

    const uniqueAppName = `${appName}-${randomBytes(2).toString('hex')}`;
    const service = this.serviceRepository.create({
      ...serviceData,
      appName: uniqueAppName,
      project: project,
    });

    if (remoteServerId != null) {
      service.remoteServer = await this.remoteServerRepository.findOneByOrFail({
        id: remoteServerId,
      });
    }
    if (buildRemoteServerId != null) {
      service.buildRemoteServer = await this.remoteServerRepository.findOneByOrFail({
        id: buildRemoteServerId,
      });
    }

    if (registryPushInCreate !== undefined && registryPushInCreate !== null) {
      const t = String(registryPushInCreate).trim();
      if (t.length > 0 && serviceData.composeType !== composeType.APPLICATION) {
        throw new BadRequestException(
          'registryPushImage applies only to application (Swarm) services.',
        );
      }
      if (t.length > 0) {
        this.validateDockerImageRef(t);
      }
    }

    this.assertRegistryForLocalBuildOnApiRemoteDeploy(
      serviceData.composeType,
      remoteServerId,
      serviceData.buildOnLocalDockerHost === true,
      serviceData.dockerConfig || '',
      registryPushInCreate,
    );

    let saved = await this.serviceRepository.save(service);

    if (
      registryPushInCreate !== undefined &&
      saved.composeType === composeType.APPLICATION &&
      (saved.dockerConfig || '').trim().length > 0
    ) {
      saved.dockerConfig = this.mergeRegistryPushHeader(saved.dockerConfig, registryPushInCreate);
      saved.dockerConfig = await this.composeApplicationDockerConfigForService(saved);
      saved = await this.serviceRepository.save(saved);
    }

    const hydrated =
      (await this.serviceRepository.findOne({
        where: { id: saved.id },
        relations: ['project', 'remoteServer'],
      })) ?? saved;
    return this.withMagicTraefikMeUrl(hydrated);
  }

  /**
   * Building on the API host while deploying to a remote Swarm requires push+pull via a registry.
   */
  private assertRegistryForLocalBuildOnApiRemoteDeploy(
    serviceComposeType: composeType,
    remoteServerId: number | null | undefined,
    buildOnLocalDockerHost: boolean,
    dockerConfig: string,
    registryPushImage?: string | null,
  ): void {
    if (serviceComposeType !== composeType.APPLICATION) return;
    if (!buildOnLocalDockerHost || remoteServerId == null) return;
    const fromHeader = this.parseConfigHeaderValue(dockerConfig, 'registry.pushImage')?.trim();
    const fromArg =
      registryPushImage != null && String(registryPushImage).trim() !== ''
        ? String(registryPushImage).trim()
        : '';
    if (!fromHeader && !fromArg) {
      throw new BadRequestException(
        'When build runs on this server and deploy targets a remote host, set a registry image so the remote can pull the image after push.',
      );
    }
  }

  private parseConfigHeaderValue(config: string, key: string): string | null {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = (config || '').match(
      new RegExp(`^\\s*#\\s*${escaped}:\\s*(.+)$`, 'm'),
    );
    return m?.[1]?.trim() || null;
  }

  /** Dokploy-style: build tags this ref, push, stack deploy pulls on deploy host (after `docker login` on API host). */
  private mergeRegistryPushHeader(
    config: string,
    ref: string | null | undefined,
  ): string {
    const lines = (config || '').split(/\r?\n/);
    const without = lines.filter((l) => !/^\s*#\s*registry\.pushImage:/i.test(l));
    if (ref == null || String(ref).trim() === '') {
      return without.join('\n');
    }
    const trimmed = this.validateDockerImageRef(String(ref));
    const insert = `# registry.pushImage: ${trimmed}`;
    const idx = without.findIndex((l) => /#\s*weehawk application/i.test(l));
    if (idx >= 0) {
      const next = [...without];
      next.splice(idx + 1, 0, insert);
      return next.join('\n');
    }
    return `${insert}\n${without.join('\n')}`;
  }

  private normalizeArchivePath(raw: string, fallback: string): string {
    const t = (raw || fallback).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return t || fallback;
  }

  /** Validates a Docker image reference for image-based application deploy (no local build). */
  private validateDockerImageRef(ref: string): string {
    const t = ref.trim();
    if (!t.length) {
      throw new BadRequestException('Image reference is required.');
    }
    if (t.length > 512) {
      throw new BadRequestException('Image reference is too long.');
    }
    if (/\s/.test(t)) {
      throw new BadRequestException('Image reference cannot contain whitespace.');
    }
    if (t.includes('..')) {
      throw new BadRequestException('Invalid image reference.');
    }
    return t;
  }

  /** Reads multi-network headers; falls back to legacy single `network.mode` lines. */
  private parseApplicationNetworksFromConfig(config: string): {
    external: string[];
    stack: string[];
  } {
    const raw = config || '';
    const extLine = raw.match(/^\s*#\s*app\.networks\.external:\s*(.+)$/m);
    const stackLine = raw.match(/^\s*#\s*app\.networks\.stack:\s*(.+)$/m);
    if (extLine || stackLine) {
      const external =
        extLine?.[1]
          ?.split('|')
          .map((s) => s.trim())
          .filter(Boolean) ?? [];
      const stack =
        stackLine?.[1]
          ?.split('|')
          .map((s) => s.trim())
          .filter(Boolean) ?? [];
      return { external, stack };
    }
    const mode = (
      this.parseConfigHeaderValue(raw, 'network.mode') || 'none'
    )
      .toLowerCase()
      .trim();
    if (mode === 'external') {
      const name = this.parseConfigHeaderValue(raw, 'network.name')?.trim();
      return { external: name ? [name] : [], stack: [] };
    }
    if (mode === 'stack') {
      const key =
        this.parseConfigHeaderValue(raw, 'network.key')?.trim() || 'app-network';
      return { external: [], stack: [key] };
    }
    return { external: [], stack: [] };
  }

  private normalizeApplicationNetworkPayload(dto: {
    external?: string[];
    stack?: string[];
  }): { external: string[]; stack: string[] } {
    const ext = (dto.external ?? []).map((s) => String(s).trim()).filter(Boolean);
    const stk = (dto.stack ?? []).map((k) => String(k).trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const k of stk) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,62}$/.test(k)) {
        throw new BadRequestException(`Invalid stack network key: ${k}`);
      }
      const low = k.toLowerCase();
      if (seen.has(low)) {
        throw new BadRequestException(`Duplicate stack network key: ${k}`);
      }
      seen.add(low);
    }
    return { external: ext, stack: stk };
  }

  private splitPipeNetworkField(raw: string | undefined): string[] {
    if (raw === undefined || raw === '') return [];
    return raw
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Resolves networks for upload: pipe fields (multipart-friendly) win, then networksJson,
   * then headers from the previous saved compose.
   */
  private resolveUploadNetworks(
    options:
      | {
          networksJson?: string;
          externalNetworks?: string;
          stackNetworks?: string;
        }
      | undefined,
    previousConfig: string,
  ): { external: string[]; stack: string[] } {
    const hasPipe =
      typeof options?.externalNetworks === 'string' ||
      typeof options?.stackNetworks === 'string';
    if (hasPipe) {
      const external = this.splitPipeNetworkField(
        typeof options?.externalNetworks === 'string'
          ? options.externalNetworks
          : undefined,
      );
      const stack = this.splitPipeNetworkField(
        typeof options?.stackNetworks === 'string'
          ? options.stackNetworks
          : undefined,
      );
      return this.normalizeApplicationNetworkPayload({ external, stack });
    }
    if (options?.networksJson?.trim()) {
      return this.parseNetworksJson(options.networksJson);
    }
    return this.parseApplicationNetworksFromConfig(previousConfig);
  }

  private parseNetworksJson(raw: string): { external: string[]; stack: string[] } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('networksJson must be valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('networksJson must be an object.');
    }
    const obj = parsed as Record<string, unknown>;
    const external = Array.isArray(obj.external)
      ? (obj.external as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : [];
    const stack = Array.isArray(obj.stack)
      ? (obj.stack as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : [];
    return this.normalizeApplicationNetworkPayload({ external, stack });
  }

  /** Unique compose key for a user-defined stack network (overlay). */
  private composeStackNetworkAlias(
    userKey: string,
    index: number,
    used: Set<string>,
  ): string {
    let base = userKey
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_.-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/--+/g, '-');
    if (!base) base = 'net';
    let alias = `stk_${base}`;
    if (alias.length > 63) alias = alias.slice(0, 63);
    let candidate = alias;
    let n = 0;
    while (used.has(candidate)) {
      n += 1;
      candidate = `stk_${index}_${n}`;
      if (candidate.length > 63) candidate = candidate.slice(0, 63);
    }
    used.add(candidate);
    return candidate;
  }

  /** Rebuild args for `composeApplicationDockerConfig` from saved service (headers + YAML). */
  private extractApplicationComposeRegenerationArgs(service: Service): {
    sourceDir: string;
    buildPath: string;
    dockerfilePath: string;
    buildMode: 'dockerfile' | 'buildpacks';
    dockerfileGenerated?: boolean;
    deployMode: 'source' | 'image';
    imageRef?: string;
    containerPort: number;
    publishPort?: number;
    replicas: number;
    envKeys: string[];
  } {
    const raw = service.dockerConfig || '';
    const sourceDir = this.parseConfigHeaderValue(raw, 'sourceDir') || 'app-source';
    const buildPath = this.parseConfigHeaderValue(raw, 'buildPath') || '.';
    const dockerfilePath = this.parseConfigHeaderValue(raw, 'dockerfilePath') || 'Dockerfile';
    const buildModeRaw = this.parseConfigHeaderValue(raw, 'buildMode') || 'dockerfile';
    const bm = (buildModeRaw || 'dockerfile').toLowerCase();
    const buildMode =
      bm === 'nixpacks' || bm === 'buildpacks' ? 'buildpacks' : 'dockerfile';

    const envKeys: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(
        /^\s*#\s*app\.store\.([A-Z0-9_]+):\s*(env|secret)\s*$/i,
      );
      if (m) envKeys.push(m[1]);
    }

    if (envKeys.length === 0) {
      const re = /\n\s{6}([A-Z0-9_]+):\s*\$\{([A-Z0-9_]+)\}/g;
      let mm: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((mm = re.exec(raw)) !== null) {
        if (mm[1] === mm[2] && !seen.has(mm[1])) {
          seen.add(mm[1]);
          envKeys.push(mm[1]);
        }
      }
    }

    let containerPort = 3000;
    let publishPort: number | undefined;
    let replicas = 1;
    const pm = raw.match(/ports:\s*\n\s*-\s*"(\d+):(\d+)"/);
    if (pm) {
      publishPort = parseInt(pm[1], 10);
      containerPort = parseInt(pm[2], 10);
    }
    const rm = raw.match(/replicas:\s*(\d+)/);
    if (rm) {
      const n = parseInt(rm[1], 10);
      if (!Number.isNaN(n)) replicas = Math.min(10, Math.max(1, n));
    }

    const dg = this.parseConfigHeaderValue(raw, 'dockerfileGenerated');
    const dockerfileGenerated =
      dg === 'true' ? true : dg === 'false' ? false : undefined;

    const builtTag = `${service.appName}:latest`;
    const registryPushHeader = this.parseConfigHeaderValue(raw, 'registry.pushImage')?.trim();
    const deployModeHeader = this.parseConfigHeaderValue(raw, 'deployMode')?.toLowerCase();
    const imageRefHeader = this.parseConfigHeaderValue(raw, 'imageRef')?.trim();
    const imageLineMatch = raw.match(/^\s*image:\s*(.+)$/m);
    let normalizedImage = imageLineMatch?.[1]?.trim() ?? '';
    if (normalizedImage.startsWith('"') && normalizedImage.endsWith('"')) {
      normalizedImage = normalizedImage.slice(1, -1);
    }
    if (normalizedImage.startsWith("'") && normalizedImage.endsWith("'")) {
      normalizedImage = normalizedImage.slice(1, -1);
    }

    let deployMode: 'source' | 'image';
    let imageRef: string | undefined;

    if (registryPushHeader) {
      deployMode = 'source';
      imageRef = undefined;
    } else if (deployModeHeader === 'image' || imageRefHeader) {
      deployMode = 'image';
      imageRef = imageRefHeader || normalizedImage || undefined;
    } else if (deployModeHeader === 'source') {
      deployMode = 'source';
    } else if (normalizedImage && normalizedImage !== builtTag) {
      deployMode = 'image';
      imageRef = normalizedImage;
    } else {
      deployMode = 'source';
    }

    return {
      sourceDir,
      buildPath,
      dockerfilePath,
      buildMode,
      dockerfileGenerated,
      deployMode,
      imageRef,
      containerPort,
      publishPort,
      replicas,
      envKeys,
    };
  }

  private sanitizeDomainForTraefikRule(raw: string): string | null {
    const host =
      raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.trim() ?? '';
    if (!host || host.length > 253) return null;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
    return host;
  }

  private sanitizeTraefikRouterBase(service: Service): string {
    const slug = service.appName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/--+/g, '-');
    const base = `wh${service.id}_${slug || 'app'}`;
    return base.slice(0, 60);
  }

  private collectServiceTraefikHosts(service: Service): string[] {
    const out = new Set<string>();
    if (service.traefikRoutes?.length) {
      for (const r of service.traefikRoutes) {
        for (const h of r.hosts ?? []) {
          const s = this.sanitizeDomainForTraefikRule(h);
          if (s) out.add(s);
        }
      }
      return [...out];
    }
    for (const d of service.domains ?? []) {
      const s = this.sanitizeDomainForTraefikRule(d);
      if (s) out.add(s);
    }
    return [...out];
  }

  /** Loads `project` and `remoteServer` when missing — required for Magic Traefik.me hostnames. */
  private async ensureServiceForMagicDomains(service: Service): Promise<Service> {
    const needProject = !service.project?.id;
    const needRemote =
      service.remoteServerId != null && service.remoteServer === undefined;
    if (!needProject && !needRemote) return service;
    const row = await this.serviceRepository.findOne({
      where: { id: service.id },
      relations: ['project', 'remoteServer'],
    });
    return row ?? service;
  }

  private sanitizePlatformHostForComparison(raw: string | null | undefined): string {
    if (raw == null || typeof raw !== 'string') return '';
    const host =
      raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.trim() ?? '';
    return host;
  }

  private isMagicTraefikMeEnabled(): boolean {
    const v = this.configService.get<string>('WEEHAWK_MAGIC_TRAEFIK_ME_ENABLED');
    if (v === undefined || v === null || String(v).trim() === '') return true;
    return !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());
  }

  /** Priority: selected deploy remote host → service-saved override → API env (fallback only). */
  private resolveDeployPublicIpv4(service: Service): string | null {
    const fromRs = service.remoteServer?.publicIpv4?.trim();
    if (fromRs && parseIpv4Octets(fromRs)) return fromRs;
    const fromSvc = service.magicTraefikMeIpv4?.trim();
    if (fromSvc && parseIpv4Octets(fromSvc)) return fromSvc;
    const fromEnv = this.configService
      .get<string>('WEEHAWK_MAGIC_TRAEFIK_ME_PUBLIC_IP')
      ?.trim();
    if (fromEnv && parseIpv4Octets(fromEnv)) return fromEnv;
    return null;
  }

  /**
   * Magic traefik.me host only when the user rolled the dice (`magicTraefikMeNonce` set).
   * Not auto-generated for every service.
   */
  private async resolveMagicTraefikMeHostname(
    service: Service,
    platformHostNormalized: string,
  ): Promise<string | null> {
    if (!this.isMagicTraefikMeEnabled()) return null;
    if (service.composeType !== composeType.APPLICATION) return null;
    if (!service.project?.id) return null;
    const nonce = service.magicTraefikMeNonce?.trim();
    if (!nonce) return null;
    const ipv4 = this.resolveDeployPublicIpv4(service);
    if (!ipv4) return null;
    const hostname = buildTraefikMeMagicHostname(
      service.project.name,
      service.name,
      nonce,
      ipv4,
    );
    if (!hostname) return null;
    if (
      platformHostNormalized &&
      hostname.toLowerCase() === platformHostNormalized
    ) {
      return null;
    }
    return hostname;
  }

  /**
   * User rolls dice: new 6-char hex nonce + optional stack YAML refresh for Swarm apps.
   * `dto.publicIpv4` is saved on the service when provided (user-controlled; e.g. 127.0.0.1).
   */
  async rollMagicTraefikMeDomain(
    id: number,
    userId: number,
    dto?: { publicIpv4?: string },
  ) {
    let s = await this.assertServiceOwnedByUser(id, userId);
    if (s.composeType !== composeType.APPLICATION) {
      throw new BadRequestException(
        'Magic traefik.me applies only to application (Swarm) services.',
      );
    }
    s = await this.ensureServiceForMagicDomains(s);
    if (!s.project?.id) {
      throw new BadRequestException('Service has no project.');
    }
    const fromBody = dto?.publicIpv4?.trim();
    if (fromBody) {
      if (!parseIpv4Octets(fromBody)) {
        throw new BadRequestException('publicIpv4 must be a valid dotted IPv4 address.');
      }
      s.magicTraefikMeIpv4 = fromBody;
    }
    const settings = await this.traefikService.getSettings();
    const platformHost = this.sanitizePlatformHostForComparison(
      settings.platformDomain,
    );
    const ipv4 = this.resolveDeployPublicIpv4(s);
    if (!ipv4) {
      throw new BadRequestException(
        'Enter an IPv4 address for Magic traefik.me (saved on this service), or set it on the remote host.',
      );
    }
    const nonce = randomBytes(3).toString('hex');
    const hostname = buildTraefikMeMagicHostname(
      s.project.name,
      s.name,
      nonce,
      ipv4,
    );
    if (!hostname) {
      throw new BadRequestException('Could not build magic hostname.');
    }
    if (platformHost && hostname.toLowerCase() === platformHost) {
      throw new BadRequestException(
        'Magic hostname would collide with the platform domain (Traefik UI).',
      );
    }
    s.magicTraefikMeNonce = nonce;
    await this.serviceRepository.save(s);
    s = await this.assertServiceOwnedByUser(id, userId);
    if ((s.dockerConfig || '').includes('# weehawk application service')) {
      s.dockerConfig = await this.composeApplicationDockerConfigForService(s);
      await this.serviceRepository.save(s);
    }
    const fresh = await this.assertServiceOwnedByUser(id, userId);
    return this.withMagicTraefikMeUrl(fresh);
  }

  /** Remove Magic traefik.me host from Traefik labels (no auto-publish). */
  async clearMagicTraefikMeDomain(id: number, userId: number) {
    let s = await this.assertServiceOwnedByUser(id, userId);
    if (s.composeType !== composeType.APPLICATION) {
      throw new BadRequestException(
        'Magic traefik.me applies only to application (Swarm) services.',
      );
    }
    s.magicTraefikMeNonce = null;
    await this.serviceRepository.save(s);
    s = await this.assertServiceOwnedByUser(id, userId);
    if ((s.dockerConfig || '').includes('# weehawk application service')) {
      s.dockerConfig = await this.composeApplicationDockerConfigForService(s);
      await this.serviceRepository.save(s);
    }
    const fresh = await this.assertServiceOwnedByUser(id, userId);
    return this.withMagicTraefikMeUrl(fresh);
  }

  async computeMagicTraefikMeQuickAccessUrl(service: Service): Promise<string | null> {
    const svc = await this.ensureServiceForMagicDomains(service);
    const settings = await this.traefikService.getSettings();
    const platformHost = this.sanitizePlatformHostForComparison(
      settings.platformDomain,
    );
    const host = await this.resolveMagicTraefikMeHostname(svc, platformHost);
    if (!host) return null;
    return `https://${host}`;
  }

  async withMagicTraefikMeUrl<T extends Service>(
    service: T,
  ): Promise<T & { magicTraefikMeUrl: string | null }> {
    const magicTraefikMeUrl = await this.computeMagicTraefikMeQuickAccessUrl(service);
    return { ...service, magicTraefikMeUrl };
  }

  /**
   * Every application (Swarm) service attaches to the external `weehawk` overlay so Traefik
   * (deployed on the same network) can reach the app without extra user configuration.
   */
  private ensureTraefikExternalNetwork(
    network: { external: string[]; stack: string[] },
    service: Service,
  ): { external: string[]; stack: string[] } {
    const proxy = WEEHAWK_TRAEFIK_EXTERNAL_NETWORK;
    if (service.composeType !== composeType.APPLICATION) {
      return network;
    }
    const ext = [...network.external];
    if (!ext.some((n) => n === proxy)) ext.push(proxy);
    return { external: ext, stack: [...network.stack] };
  }

  private sanitizePathPrefixForRule(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const t = raw.trim();
    if (!t) return null;
    if (!t.startsWith('/')) return null;
    if (!/^\/[A-Za-z0-9/._~-]*$/.test(t)) return null;
    return t;
  }

  private buildTraefikHostPathRule(
    hosts: string[],
    pathPrefix: string | null | undefined,
  ): string {
    const cleaned = hosts
      .map((h) => this.sanitizeDomainForTraefikRule(h))
      .filter((x): x is string => Boolean(x));
    if (!cleaned.length) return '';
    const hostExpr =
      cleaned.length === 1
        ? `Host(\`${cleaned[0]}\`)`
        : `(${cleaned.map((h) => `Host(\`${h}\`)`).join(' || ')})`;
    const pp = this.sanitizePathPrefixForRule(pathPrefix ?? null);
    if (!pp) return hostExpr;
    return `(${hostExpr}) && PathPrefix(\`${pp}\`)`;
  }

  private escapeTraefikComposeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private buildTraefikLabelSection(
    traefik?: {
      certResolver: string;
      httpEntrypoint: string;
      httpsEntrypoint: string;
      routes: Array<{ router: string; rule: string; port: number; https: boolean }>;
    },
  ): string {
    if (!traefik?.routes?.length) return '';
    const lines: string[] = ['      labels:', '        - "traefik.enable=true"'];
    /** One Traefik loadbalancer service per port; all routers reference it (Docker/Swarm multi-router pattern). */
    const lbPortsSeen = new Set<number>();
    for (const r of traefik.routes) {
      const ruleEsc = this.escapeTraefikComposeLabelValue(r.rule);
      const useTls = r.https !== false;
      const ep = useTls ? traefik.httpsEntrypoint : traefik.httpEntrypoint;
      const lbSvc = `whlb_${r.port}`;
      lines.push(`        - "traefik.http.routers.${r.router}.rule=${ruleEsc}"`);
      lines.push(`        - "traefik.http.routers.${r.router}.entrypoints=${ep}"`);
      lines.push(`        - "traefik.http.routers.${r.router}.service=${lbSvc}"`);
      if (useTls) {
        lines.push(
          `        - "traefik.http.routers.${r.router}.tls.certresolver=${traefik.certResolver}"`,
        );
      }
      if (!lbPortsSeen.has(r.port)) {
        lbPortsSeen.add(r.port);
        lines.push(
          `        - "traefik.http.services.${lbSvc}.loadbalancer.server.port=${r.port}"`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private async buildTraefikIngressForCompose(
    service: Service,
    containerPort: number,
  ): Promise<
    | {
        certResolver: string;
        httpEntrypoint: string;
        httpsEntrypoint: string;
        routes: Array<{ router: string; rule: string; port: number; https: boolean }>;
      }
    | undefined
  > {
    if (service.composeType !== composeType.APPLICATION) {
      return undefined;
    }
    const svc = await this.ensureServiceForMagicDomains(service);
    const settings = await this.traefikService.getSettings();
    const platformHost = this.sanitizePlatformHostForComparison(
      settings.platformDomain,
    );
    const magicHost = await this.resolveMagicTraefikMeHostname(svc, platformHost);
    const certResolver = (settings.certResolverName || 'letsencrypt').trim();
    const httpEntrypoint = (settings.httpEntrypoint || 'web').trim();
    const httpsEntrypoint = (settings.httpsEntrypoint || 'websecure').trim();
    const routes: Array<{
      router: string;
      rule: string;
      port: number;
      https: boolean;
    }> = [];

    const appendMagicAlias = (hosts: string[]): string[] => {
      if (!magicHost) return hosts;
      const lower = new Set(hosts.map((h) => h.toLowerCase()));
      if (lower.has(magicHost.toLowerCase())) return hosts;
      return [...hosts, magicHost];
    };

    if (svc.traefikRoutes && svc.traefikRoutes.length > 0) {
      const multiRoute = svc.traefikRoutes.length > 1;
      for (let i = 0; i < svc.traefikRoutes.length; i++) {
        const r = svc.traefikRoutes[i];
        const router = (r.router || '').trim().toLowerCase();
        if (!router) continue;
        let hosts = (r.hosts ?? [])
          .map((h) => this.sanitizeDomainForTraefikRule(h))
          .filter((x): x is string => Boolean(x));
        // Magic hostname must not be appended to every router: multiple Host(magic) rules match the same
        // request and Traefik routing becomes ambiguous (often 404). Only the first listed route gets the alias.
        if (!multiRoute) {
          hosts = appendMagicAlias(hosts);
        } else if (i === 0) {
          hosts = appendMagicAlias(hosts);
        }
        if (!hosts.length) continue;
        const rule = this.buildTraefikHostPathRule(hosts, r.pathPrefix);
        if (!rule) continue;
        const port =
          r.port != null && Number.isFinite(Number(r.port))
            ? Math.min(65535, Math.max(1, Math.floor(Number(r.port))))
            : containerPort;
        const https = r.https !== false;
        routes.push({ router, rule, port, https });
      }
      if (!routes.length && magicHost) {
        const rule = this.buildTraefikHostPathRule([magicHost], null);
        if (rule) {
          routes.push({
            router: this.sanitizeTraefikRouterBase(svc),
            rule,
            port: containerPort,
            https: true,
          });
        }
      }
    } else {
      let ruleDomains = (svc.domains ?? [])
        .map((d) => this.sanitizeDomainForTraefikRule(d))
        .filter((x): x is string => Boolean(x));
      ruleDomains = appendMagicAlias(ruleDomains);
      if (!ruleDomains.length) return undefined;
      const rule = this.buildTraefikHostPathRule(ruleDomains, null);
      routes.push({
        router: this.sanitizeTraefikRouterBase(svc),
        rule,
        port: containerPort,
        https: true,
      });
    }

    if (!routes.length) return undefined;
    return { certResolver, httpEntrypoint, httpsEntrypoint, routes };
  }

  private async composeApplicationDockerConfigForService(
    service: Service,
    networkOverride?: { external: string[]; stack: string[] },
  ): Promise<string> {
    const args = this.extractApplicationComposeRegenerationArgs(service);
    let network =
      networkOverride ??
      this.parseApplicationNetworksFromConfig(service.dockerConfig || '');
    network = this.ensureTraefikExternalNetwork(network, service);
    const registryPush = this.parseConfigHeaderValue(
      service.dockerConfig || '',
      'registry.pushImage',
    )?.trim();
    const imageName =
      registryPush?.length
        ? registryPush
        : args.deployMode === 'image' && args.imageRef?.trim()
          ? args.imageRef.trim()
          : `${service.appName}:latest`;
    const traefik = await this.buildTraefikIngressForCompose(
      service,
      args.containerPort,
    );
    return this.composeApplicationDockerConfig({
      sourceDir: args.sourceDir,
      buildPath: args.buildPath,
      dockerfilePath: args.dockerfilePath,
      buildMode: args.buildMode,
      dockerfileGenerated: args.dockerfileGenerated,
      deployMode: args.deployMode,
      imageRef: args.deployMode === 'image' ? args.imageRef : undefined,
      imageName,
      registryPushImage: registryPush?.length ? registryPush : undefined,
      containerPort: args.containerPort,
      publishPort: args.publishPort,
      replicas: args.replicas,
      envKeys: args.envKeys,
      network,
      traefik,
    });
  }

  private composeApplicationDockerConfig(args: {
    sourceDir: string;
    buildPath: string;
    dockerfilePath: string;
    buildMode: 'dockerfile' | 'buildpacks';
    /** True when Weehawk generated Dockerfile; omitted when unknown (legacy). */
    dockerfileGenerated?: boolean;
    /** Source = build from uploaded context; image = use pre-built imageRef / imageName. */
    deployMode: 'source' | 'image';
    /** Echoed in header when deployMode is image. */
    imageRef?: string;
    imageName: string;
    /** Persisted in YAML so rebuilds keep registry-based deploy. */
    registryPushImage?: string | null;
    containerPort: number;
    publishPort?: number;
    replicas: number;
    envKeys: string[];
    network: { external: string[]; stack: string[] };
    traefik?: {
      certResolver: string;
      httpEntrypoint: string;
      httpsEntrypoint: string;
      routes: Array<{ router: string; rule: string; port: number; https: boolean }>;
    };
  }): string {
    const ports =
      args.publishPort != null
        ? `    ports:\n      - "${args.publishPort}:${args.containerPort}"\n`
        : '';
    const envLines = args.envKeys.map((k) => `      ${k}: \${${k}}`);
    const envSection = envLines.length ? `    environment:\n${envLines.join('\n')}\n` : '';

    const ext = (args.network.external ?? []).map((n) => n.trim()).filter(Boolean);
    const stk = (args.network.stack ?? []).map((k) => k.trim()).filter(Boolean);

    const networkHeaderLines: string[] = [];
    if (ext.length) networkHeaderLines.push(`# app.networks.external: ${ext.join('|')}`);
    if (stk.length) networkHeaderLines.push(`# app.networks.stack: ${stk.join('|')}`);
    if (!ext.length && !stk.length) networkHeaderLines.push(`# app.networks: none`);
    const networkHeader = networkHeaderLines.map((l) => `${l}\n`).join('');

    const svcNetLines: string[] = [];
    const rootNetBlocks: string[] = [];
    const usedAliases = new Set<string>();

    ext.forEach((name, i) => {
      const alias = `ext${i}`;
      usedAliases.add(alias);
      svcNetLines.push(`      - ${alias}`);
      rootNetBlocks.push(`  ${alias}:\n    external: true\n    name: ${name}`);
    });

    stk.forEach((userKey, i) => {
      const alias = this.composeStackNetworkAlias(userKey, i, usedAliases);
      svcNetLines.push(`      - ${alias}`);
      rootNetBlocks.push(`  ${alias}:\n    driver: overlay\n    attachable: true`);
    });

    const svcNetworkSection = svcNetLines.length
      ? `    networks:\n${svcNetLines.join('\n')}\n`
      : '';

    const rootNetworkSection = rootNetBlocks.length
      ? `networks:\n${rootNetBlocks.join('\n')}\n`
      : '';

    const storageHeader = args.envKeys.map((k) => `# app.store.${k}: env`).join('\n');
    const dockerfileGenLine =
      args.dockerfileGenerated !== undefined
        ? `# dockerfileGenerated: ${args.dockerfileGenerated ? 'true' : 'false'}\n`
        : '';
    const imageRefLine =
      args.deployMode === 'image' && args.imageRef
        ? `# imageRef: ${args.imageRef}\n`
        : '';
    const traefikHeader =
      args.traefik?.routes?.length && args.traefik
        ? `# traefik.routers: ${args.traefik.routes.map((r) => r.router).join('|')}\n`
        : '';
    const registryPushLine =
      args.registryPushImage?.trim()
        ? `# registry.pushImage: ${args.registryPushImage.trim()}\n`
        : '';
    const traefikLabelsSection = this.buildTraefikLabelSection(args.traefik);
    return `# weehawk application service
${registryPushLine}# sourceDir: ${args.sourceDir}
# buildPath: ${args.buildPath}
# dockerfilePath: ${args.dockerfilePath}
# buildMode: ${args.buildMode}
# deployMode: ${args.deployMode}
${imageRefLine}${dockerfileGenLine}${traefikHeader}${networkHeader}${storageHeader ? `${storageHeader}\n` : ''}version: '3.8'

services:
  app:
    image: ${args.imageName}
${ports}    deploy:
      replicas: ${args.replicas}
      restart_policy:
        condition: on-failure
      placement:
        constraints:
          - node.role == manager
${traefikLabelsSection}${envSection}${svcNetworkSection}${rootNetworkSection}`;
  }

  private async extractZipSafely(zipPath: string, targetDir: string): Promise<void> {
    const directory = await unzipper.Open.file(zipPath);
    await fs.mkdir(targetDir, { recursive: true });
    for (const entry of directory.files) {
      const normalized = path.normalize(entry.path);
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        continue;
      }
      const outPath = path.join(targetDir, normalized);
      const relative = path.relative(targetDir, outPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        continue;
      }
      if (entry.type === 'Directory') {
        await fs.mkdir(outPath, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await new Promise<void>((resolve, reject) => {
          entry
            .stream()
            .pipe(fss.createWriteStream(outPath))
            .on('finish', () => resolve())
            .on('error', (e) => reject(e));
        });
      }
    }
  }

  private async listFilesRecursively(dir: string, relativePrefix = ''): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.listFilesRecursively(abs, rel)));
      } else if (entry.isFile()) {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
    return out;
  }

  private async resolveDockerfilePath(
    sourceDir: string,
    buildPath: string,
    requestedPath?: string,
  ): Promise<string> {
    const contextDir = path.join(sourceDir, buildPath);
    await fs.access(contextDir);

    const requested = (requestedPath || '').trim();
    if (requested) {
      const normalizedRequested = this.normalizeArchivePath(requested, 'Dockerfile');
      const absRequested = path.join(contextDir, normalizedRequested);
      const exists = await fs
        .access(absRequested)
        .then(() => true)
        .catch(() => false);
      if (exists) return normalizedRequested;
    }

    const files = await this.listFilesRecursively(contextDir);
    const dockerfileCandidates = files.filter((rel) =>
      /(^|\/)dockerfile(\.[^/]*)?$/i.test(rel),
    );

    if (dockerfileCandidates.length === 0) {
      throw new BadRequestException(
        `Dockerfile not found in archive under build path "${buildPath}".`,
      );
    }

    const exactRoot = dockerfileCandidates.find((p) => p === 'Dockerfile');
    if (exactRoot) return exactRoot;

    const caseInsensitiveRoot = dockerfileCandidates.find(
      (p) => p.toLowerCase() === 'dockerfile',
    );
    if (caseInsensitiveRoot) return caseInsensitiveRoot;

    dockerfileCandidates.sort((a, b) => a.split('/').length - b.split('/').length);
    return dockerfileCandidates[0];
  }

  /**
   * Update application stack networks (external attach + overlay keys) and regenerate
   * `dockerConfig` while preserving build metadata and env/secret wiring.
   */
  async patchApplicationNetworks(
    id: number,
    dto: { external?: string[]; stack?: string[] },
    userId: number,
  ) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException(
        'This service is not an application-type service.',
      );
    }
    const { external: ext, stack: stk } = this.normalizeApplicationNetworkPayload(dto);

    const yamlEnvBefore = {
      dockerConfig: service.dockerConfig ?? '',
      env: service.env ?? '',
    };
    service.dockerConfig = await this.composeApplicationDockerConfigForService(service, {
      external: ext,
      stack: stk,
    });
    const saved = await this.serviceRepository.save(service);
    this.mirrorDeployHostAfterYamlOrEnvChangeIfNeeded(yamlEnvBefore, saved, userId);
    return saved;
  }

  private async applyApplicationSourceFromDirectory(
    service: Service,
    sourceDir: string,
    options:
      | {
          buildPath?: string;
          dockerfilePath?: string;
          buildMode?: 'dockerfile' | 'buildpacks' | 'nixpacks';
          containerPort?: number;
          publishPort?: number;
          replicas?: number;
          variablesJson?: string;
          networksJson?: string;
          externalNetworks?: string;
          stackNetworks?: string;
        }
      | undefined,
    sourceKind: 'archive' | 'repository',
  ): Promise<Service> {
    let buildPath = this.normalizeArchivePath(options?.buildPath || '.', '.');
    let dockerfilePath = this.normalizeArchivePath(options?.dockerfilePath || '', '');
    /** Dockerfile-first only; buildpacks/nixpacks are deprecated and mapped to this flow. */
    const buildMode: 'dockerfile' = 'dockerfile';
    let containerPort = options?.containerPort ?? 3000;
    const publishPort = options?.publishPort;
    const replicas = Math.min(10, Math.max(1, Math.floor(options?.replicas ?? 1)));
    const parsedVars = this.parseApplicationVariables(options?.variablesJson);
    const valuesMap = this.resolveApplicationValuesMap(parsedVars);

    let dockerfileGenerated: boolean | undefined;
    try {
      const contextDir = path.join(sourceDir, buildPath);
      try {
        await fs.access(contextDir);
      } catch {
        throw new BadRequestException(
          sourceKind === 'archive'
            ? `Build path not found in archive: "${buildPath}".`
            : `Build path not found in repository: "${buildPath}".`,
        );
      }

      const gen = await this.dockerfileGenerator.ensureDockerfileForContext(contextDir, {
        port: containerPort,
      });

      if (gen.usedUserDockerfile) {
        dockerfileGenerated = false;
        dockerfilePath = await this.resolveDockerfilePath(
          sourceDir,
          buildPath,
          dockerfilePath || undefined,
        );
      } else {
        dockerfileGenerated = true;
        dockerfilePath = 'Dockerfile';
        if (gen.kind === 'static' && options?.containerPort === undefined) {
          containerPort = 80;
        }
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        sourceKind === 'archive'
          ? 'Could not read archive build context.'
          : 'Could not read repository build context.',
      );
    }

    const previousConfig = service.dockerConfig || '';
    await this.removeObsoleteManagedSecrets(previousConfig, {});
    const managedKeys = this.parseManagedApplicationKeysFromHeader(previousConfig);
    const envWithoutManaged = this.removeEnvKeys(service.env || '', managedKeys);
    service.env = this.mergeCredentialsIntoEnv(envWithoutManaged, valuesMap);

    const network = this.resolveUploadNetworks(options, previousConfig);
    const networkMerged = this.ensureTraefikExternalNetwork(network, service);
    const traefik = await this.buildTraefikIngressForCompose(service, containerPort);

    const preservedRegistry = this.parseConfigHeaderValue(
      previousConfig,
      'registry.pushImage',
    )?.trim();
    const registryRef =
      preservedRegistry && preservedRegistry.length > 0 ? preservedRegistry : undefined;
    const imageNameForStack = registryRef ?? `${service.appName}:latest`;

    service.dockerConfig = this.composeApplicationDockerConfig({
      sourceDir: 'app-source',
      buildPath,
      dockerfilePath,
      buildMode,
      deployMode: 'source',
      imageRef: undefined,
      dockerfileGenerated,
      imageName: imageNameForStack,
      registryPushImage: registryRef,
      containerPort,
      publishPort,
      replicas,
      envKeys: Object.keys(valuesMap),
      network: networkMerged,
      traefik,
    });
    const saved = await this.serviceRepository.save(service);
    const hydrated =
      (await this.serviceRepository.findOne({
        where: { id: saved.id },
        relations: ['project', 'remoteServer'],
      })) ?? saved;
    return this.withMagicTraefikMeUrl(hydrated);
  }

  private async cloneGitRepository(
    cloneUrl: string,
    dest: string,
    branch?: string | null,
  ): Promise<void> {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const args = ['clone', '--depth', '1'];
    if (branch?.trim()) {
      args.push('--branch', branch.trim());
    }
    args.push(cloneUrl, dest);
    try {
      await execFileAsync('git', args, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 600_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (e) {
      const msg = getErrorMessage(e);
      throw new BadRequestException(`git clone failed: ${msg}`);
    }
  }

  private async resolveApplicationGitCloneSource(options: {
    gitlabProjectId?: number;
    httpUrlToRepo?: string;
    githubInstallationId?: number;
    githubRepoFullName?: string;
    branch?: string;
  }): Promise<{ cloneUrl: string; branch: string | null | undefined }> {
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

    let cloneUrl: string;
    let branch: string | null | undefined = options.branch?.trim() || null;

    if (hasGitlabId) {
      const info = await this.gitService.gitlabCloneInfoForProject(
        options.gitlabProjectId!,
      );
      cloneUrl = info.cloneUrl;
      if (!branch) branch = info.defaultBranch;
    } else if (hasGithub) {
      const info = await this.gitService.githubCloneInfoForInstallationRepo(
        options.githubInstallationId!,
        options.githubRepoFullName!.trim(),
      );
      cloneUrl = info.cloneUrl;
      if (!branch) branch = info.defaultBranch;
    } else {
      const trimmed = options.httpUrlToRepo!.trim();
      let host: string;
      try {
        host = new URL(trimmed).hostname.toLowerCase();
      } catch {
        throw new BadRequestException('Invalid clone URL');
      }
      if (host === 'github.com') {
        cloneUrl = await this.gitService.resolveGithubHttpCloneUrl(trimmed);
      } else {
        cloneUrl = await this.gitService.resolveGitlabHttpCloneUrl(trimmed);
      }
    }

    return { cloneUrl, branch };
  }

  async uploadApplicationArchive(
    id: number,
    file: Express.Multer.File,
    userId: number,
    options?: {
      buildPath?: string;
      dockerfilePath?: string;
      buildMode?: 'dockerfile' | 'buildpacks' | 'nixpacks';
      containerPort?: number;
      publishPort?: number;
      replicas?: number;
      variablesJson?: string;
      /** JSON `{ "external": string[], "stack": string[] }` — overrides networks from previous config when set. */
      networksJson?: string;
      /** Pipe-separated external network names (multipart-friendly). */
      externalNetworks?: string;
      /** Pipe-separated stack overlay keys (multipart-friendly). */
      stackNetworks?: string;
    },
  ) {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('ZIP file is required.');
    }
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException('This service is not an application-type service.');
    }

    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const sourceDir = path.join(deployDir, 'app-source');
    const zipPath = path.join(deployDir, 'upload.zip');
    await fs.mkdir(deployDir, { recursive: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.writeFile(zipPath, file.buffer);
    try {
      await this.extractZipSafely(zipPath, sourceDir);
    } finally {
      await fs.rm(zipPath, { force: true });
    }

    const saved = await this.applyApplicationSourceFromDirectory(
      service,
      sourceDir,
      options,
      'archive',
    );
    const remoteMirror = await this.pushApplicationMirrorToDeployHostIfConfigured(id, userId);
    return {
      success: true,
      message: 'Archive uploaded and application stack generated.',
      service: saved,
      remoteMirror,
    };
  }

  async uploadApplicationFromGitClone(
    id: number,
    options: {
      gitlabProjectId?: number;
      githubInstallationId?: number;
      githubRepoFullName?: string;
      httpUrlToRepo?: string;
      branch?: string;
      buildPath?: string;
      dockerfilePath?: string;
      containerPort?: number;
      publishPort?: number;
      replicas?: number;
      variablesJson?: string;
      networksJson?: string;
      externalNetworks?: string;
      stackNetworks?: string;
    },
    userId: number,
  ) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException('This service is not an application-type service.');
    }

    const { cloneUrl, branch } =
      await this.resolveApplicationGitCloneSource(options);

    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const sourceDir = path.join(deployDir, 'app-source');
    await fs.mkdir(deployDir, { recursive: true });

    await this.cloneGitRepository(cloneUrl, sourceDir, branch);

    const saved = await this.applyApplicationSourceFromDirectory(
      service,
      sourceDir,
      options,
      'repository',
    );
    const remoteMirror = await this.pushApplicationMirrorToDeployHostIfConfigured(id, userId);
    return {
      success: true,
      message: 'Repository cloned and application stack generated.',
      service: saved,
      remoteMirror,
    };
  }

  /**
   * Clone Git repository into `app-source` only (no stack YAML). User configures port/env then calls {@link generateApplicationFromSource}.
   */
  async stageApplicationGitClone(
    id: number,
    options: {
      gitlabProjectId?: number;
      githubInstallationId?: number;
      githubRepoFullName?: string;
      httpUrlToRepo?: string;
      branch?: string;
    },
    userId: number,
  ) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException('This service is not an application-type service.');
    }

    const { cloneUrl, branch } =
      await this.resolveApplicationGitCloneSource(options);

    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const sourceDir = path.join(deployDir, 'app-source');
    await fs.mkdir(deployDir, { recursive: true });

    await this.cloneGitRepository(cloneUrl, sourceDir, branch);

    const fresh = await this.assertServiceOwnedByUser(id, userId);
    return {
      success: true,
      message:
        'Repository fetched into app source. Configure port and options, then generate the stack.',
      service: fresh,
    };
  }

  /**
   * Build stack YAML from existing `app-source` (after git stage or same as re-apply after changing options).
   */
  async generateApplicationFromSource(
    id: number,
    options: {
      buildPath?: string;
      dockerfilePath?: string;
      containerPort?: number;
      publishPort?: number;
      replicas?: number;
      variablesJson?: string;
      networksJson?: string;
      externalNetworks?: string;
      stackNetworks?: string;
    },
    userId: number,
  ) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException('This service is not an application-type service.');
    }

    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const sourceDir = path.join(deployDir, 'app-source');
    try {
      await fs.access(sourceDir);
    } catch {
      throw new BadRequestException(
        'No application source on disk. Fetch a Git repository or upload a ZIP archive first.',
      );
    }
    const entries = await fs.readdir(sourceDir);
    if (entries.length === 0) {
      throw new BadRequestException('Application source directory is empty.');
    }

    const saved = await this.applyApplicationSourceFromDirectory(
      service,
      sourceDir,
      options,
      'repository',
    );
    const remoteMirror = await this.pushApplicationMirrorToDeployHostIfConfigured(id, userId);
    return {
      success: true,
      message: 'Application stack generated from source.',
      service: saved,
      remoteMirror,
    };
  }

  /**
   * Configure Swarm stack to run a pre-built image (no ZIP / docker build on deploy).
   */
  async setApplicationImageDeploy(
    id: number,
    options: {
      imageRef: string;
      containerPort?: number;
      publishPort?: number;
      replicas?: number;
      variablesJson?: string;
      networksJson?: string;
      externalNetworks?: string;
      stackNetworks?: string;
    },
    userId: number,
  ) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException('This service is not an application-type service.');
    }
    const yamlEnvBefore = {
      dockerConfig: service.dockerConfig ?? '',
      env: service.env ?? '',
    };
    const imageRef = this.validateDockerImageRef(options.imageRef);
    let containerPort = options.containerPort ?? 3000;
    const publishPort = options.publishPort;
    const replicas = Math.min(10, Math.max(1, Math.floor(options.replicas ?? 1)));
    const parsedVars = this.parseApplicationVariables(options?.variablesJson);
    const valuesMap = this.resolveApplicationValuesMap(parsedVars);

    const previousConfig = service.dockerConfig || '';
    await this.removeObsoleteManagedSecrets(previousConfig, {});
    const managedKeys = this.parseManagedApplicationKeysFromHeader(previousConfig);
    const envWithoutManaged = this.removeEnvKeys(service.env || '', managedKeys);
    service.env = this.mergeCredentialsIntoEnv(envWithoutManaged, valuesMap);

    const network = this.resolveUploadNetworks(options, previousConfig);
    const networkMerged = this.ensureTraefikExternalNetwork(network, service);
    const traefik = await this.buildTraefikIngressForCompose(service, containerPort);

    service.dockerConfig = this.composeApplicationDockerConfig({
      sourceDir: 'app-source',
      buildPath: '.',
      dockerfilePath: 'Dockerfile',
      buildMode: 'dockerfile',
      deployMode: 'image',
      imageRef,
      dockerfileGenerated: undefined,
      imageName: imageRef,
      containerPort,
      publishPort,
      replicas,
      envKeys: Object.keys(valuesMap),
      network: networkMerged,
      traefik,
    });
    const saved = await this.serviceRepository.save(service);
    this.mirrorDeployHostAfterYamlOrEnvChangeIfNeeded(yamlEnvBefore, saved, userId);
    const hydrated =
      (await this.serviceRepository.findOne({
        where: { id: saved.id },
        relations: ['project', 'remoteServer'],
      })) ?? saved;
    return {
      success: true,
      message: 'Application stack configured for image deploy.',
      service: await this.withMagicTraefikMeUrl(hydrated),
    };
  }

  private parseApplicationVariables(raw?: string): Array<{ key: string; value: string }> {
    if (!raw?.trim()) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('variablesJson must be valid JSON.');
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('variablesJson must be an array.');
    }
    const out: Array<{ key: string; value: string }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const key = String(row.key ?? '').trim();
      const value = String(row.value ?? '');
      if (!key) continue;
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        throw new BadRequestException(`Invalid variable key: ${key}`);
      }
      out.push({ key, value });
    }
    return out;
  }

  private resolveApplicationValuesMap(
    vars: Array<{ key: string; value: string }>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const v of vars) out[v.key] = v.value;
    return out;
  }

  private parseManagedApplicationKeysFromHeader(raw: string): string[] {
    const keys = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*#\s*app\.store\.([A-Z0-9_]+):\s*(env|secret)\s*$/i);
      if (m?.[1]) keys.add(m[1]);
    }
    return Array.from(keys);
  }

  private removeEnvKeys(existing: string, keys: string[]): string {
    if (!existing || keys.length === 0) return existing;
    const set = new Set(keys);
    const out: string[] = [];
    for (const line of existing.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        out.push(line);
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) {
        out.push(line);
        continue;
      }
      const k = line.slice(0, eq).trim();
      if (!set.has(k)) out.push(line);
    }
    return out.join('\n');
  }


  /** First `services:` key in compose YAML (matches deploy / exec targets). */
  private firstComposeServiceName(config: string): string {
    const lines = config.split(/\r?\n/);
    let inServices = false;
    for (const line of lines) {
      const t = line.trim();
      if (!inServices) {
        if (t === 'services:' || /^\s*services:\s*$/.test(line)) inServices = true;
        continue;
      }
      if (!t || t.startsWith('#')) continue;
      if (/^[a-zA-Z_]/.test(line) && !line.startsWith(' ')) break;
      const m = line.match(/^\s{2}([a-zA-Z0-9_.-]+)\s*:/);
      if (m) return m[1];
    }
    return 'app';
  }

  /**
   * Stream `docker compose logs -f` or `docker service logs -f` using the same paths and
   * stack names as deploy (see `ExecutorService`).
   * When a deploy remote host is set, runs Docker on that host over SSH (same idea as the service terminal).
   */
  getServiceLogsStream(id: number, userId: number): Observable<{ data: string }> {
    return new Observable((observer) => {
      let child: ChildProcess | null = null;
      let remoteCancel: (() => void) | null = null;
      let cancelled = false;
      let stderrBuf = '';

      const shQ = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

      void (async () => {
        try {
          const service = await this.assertServiceOwnedByUser(id, userId);
          if (cancelled) return;

          const sshTargets = await this.getDockerSshTargetIds(service.id);
          const key = this.firstComposeServiceName(service.dockerConfig || '');
          const deployDir = getServiceDeploymentDir(
            service.appName,
            this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
          );
          const composeFile = path.join(deployDir, 'docker-compose.yml');

          if (sshTargets.remoteServerId != null) {
            let bashBody: string;
            if (
              service.composeType === composeType.STACK ||
              service.composeType === composeType.DATABASES
            ) {
              const stackServiceName = `${service.appName}_${key}`;
              bashBody = `docker service logs -f --tail 50 ${shQ(stackServiceName)}`;
            } else {
              const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
              const proj = shQ(service.appName);
              bashBody = `cd ${shQ(persist)} && docker compose -f docker-compose.yml -p ${proj} logs -f --tail 50`;
            }

            const { cancel } =
              await this.remoteServersService.streamDockerLogsFollowOnRemoteViaSsh(
                sshTargets.remoteServerId,
                userId,
                bashBody,
                (chunk) => {
                  if (!cancelled) observer.next({ data: chunk });
                },
                (code) => {
                  if (cancelled) return;
                  if (code !== 0 && code != null) {
                    observer.next({
                      data: `\n[docker logs exited with code ${code}]\n`,
                    });
                  }
                  observer.complete();
                },
              );
            if (cancelled) {
              cancel();
              return;
            }
            remoteCancel = cancel;
            return;
          }

          let args: string[] = [];
          const spawnOpts: { cwd?: string } = {};

          if (
            service.composeType === composeType.STACK ||
            service.composeType === composeType.DATABASES
          ) {
            const stackServiceName = `${service.appName}_${key}`;
            args = ['service', 'logs', '-f', '--tail', '50', stackServiceName];
          } else {
            const exists = await fs.access(composeFile).then(() => true).catch(() => false);
            if (!exists) {
              observer.next({
                data: `[compose] No deployment file at ${composeFile}. Deploy the service first.\n`,
              });
              observer.complete();
              return;
            }
            args = [
              'compose',
              '-f',
              composeFile,
              '-p',
              service.appName,
              'logs',
              '-f',
              '--tail',
              '50',
            ];
            spawnOpts.cwd = deployDir;
          }

          if (cancelled) return;

          child = spawn('docker', args, spawnOpts);

          child.stdout?.on('data', (data) => {
            observer.next({ data: data.toString() });
          });

          child.stderr?.on('data', (data) => {
            const errorMsg = data.toString();
            stderrBuf += errorMsg;
            if (!errorMsg.includes('Attaching to')) {
              observer.next({ data: errorMsg });
            }
          });

          child.on('error', (err) => observer.error(err));
          child.on('close', (code) => {
            if (code !== 0 && stderrBuf.trim()) {
              observer.next({
                data: `\n[docker logs exited with code ${code}]\n${stderrBuf}`,
              });
            }
            observer.complete();
          });
        } catch (err) {
          observer.error(err);
        }
      })();

      return () => {
        cancelled = true;
        remoteCancel?.();
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
      };
    });
  }

  async executeDeployment(
    id: number,
    mode: 'deploy' | 'reload' | 'redeploy' = 'deploy',
    options?: { deployLogEmitter?: EventEmitter; actingUserId?: number },
  ) {
    if (options?.actingUserId !== undefined) {
      await this.assertServiceOwnedByUser(id, options.actingUserId);
    } else {
      await this.findOne(id);
    }

    if (mode === 'redeploy' || mode === 'deploy') {
      const svc = await this.serviceRepository.findOne({ where: { id } });
      if (
        svc?.autoDeployEnabled &&
        svc.autoDeployGitProvider &&
        svc.autoDeployRepoId
      ) {
        this.log.log(
          `Auto-deploy active for service #${id} — running clone+generate before deploy.`,
        );
        const adResult = await this.runAutoDeployCloneAndDeploy(id, {
          deployLogEmitter: options?.deployLogEmitter,
        });
        return { success: adResult.success, output: adResult.output };
      }
    }

    const result = await this.executorService.execute(id, mode, options);
    if (result.success) {
      await this.serviceRepository.update(id, { lastDeployedAt: new Date() });
      try {
        const sshTargets = await this.getDockerSshTargetIds(id);
        if (sshTargets.remoteServerId != null) {
          await this.webhooksService.refreshGeneratedOnHostRedeployScriptsForService(id);
        }
      } catch {
        /* best effort — deploy already succeeded */
      }
    }
    return result;
  }

  /**
   * SFTP the current saved compose to the deploy host mirror (`/opt/weehawk-deployments/...`) without deploying.
   */
  async syncRemoteDeploymentMirror(id: number, userId: number): Promise<{ ok: boolean }> {
    await this.assertServiceOwnedByUser(id, userId);
    const r = await this.executorService.syncRemoteDeploymentMirror(id, userId);
    try {
      await this.webhooksService.refreshGeneratedOnHostRedeployScriptsForService(id);
    } catch {
      /* best effort */
    }
    return r;
  }

  /**
   * After stack YAML + app-source exist on the API host, mirror to the deploy server so builds/webhooks
   * can run there without this machine. Skips when no deploy host is selected.
   */
  private async pushApplicationMirrorToDeployHostIfConfigured(
    serviceId: number,
    userId: number,
  ): Promise<
    | { status: 'synced' }
    | { status: 'skipped'; reason: 'no_deploy_host' }
    | { status: 'failed'; message: string }
  > {
    const ssh = await this.getDockerSshTargetIds(serviceId);
    if (ssh.remoteServerId == null) {
      return { status: 'skipped', reason: 'no_deploy_host' };
    }
    try {
      await this.syncRemoteDeploymentMirror(serviceId, userId);
      return { status: 'synced' };
    } catch (e) {
      return { status: 'failed', message: getErrorMessage(e) };
    }
  }

  /**
   * When compose YAML and/or env change on disk, push the mirror to the deploy host (best-effort).
   */
  private mirrorDeployHostAfterYamlOrEnvChangeIfNeeded(
    before: Pick<Service, 'dockerConfig' | 'env'>,
    after: Pick<Service, 'id' | 'dockerConfig' | 'env'>,
    userId: number,
  ): void {
    const ymlChanged = (before.dockerConfig ?? '') !== (after.dockerConfig ?? '');
    const envChanged = (before.env ?? '') !== (after.env ?? '');
    if (!ymlChanged && !envChanged) return;
    if (!(after.dockerConfig || '').trim()) return;
    void this.pushApplicationMirrorToDeployHostIfConfigured(after.id, userId).then((r) => {
      if (r.status === 'failed') {
        this.log.warn(
          `Deploy host mirror after service #${after.id} save failed: ${r.message}`,
        );
      }
    });
  }

  private async finalizeBackupWithS3(
    userId: number,
    contextId: string,
    profileName: string | null | undefined,
    destDir: string,
    r: { success: boolean; output: string; archiveBasename?: string },
  ): Promise<{ success: boolean; output: string }> {
    if (!r.success || !r.archiveBasename) {
      return { success: r.success, output: r.output };
    }
    const trimmed = profileName?.trim();
    if (!trimmed) {
      return {
        success: false,
        output: `${r.output}\nS3 destination is not configured.`,
      };
    }
    const localPath = path.join(destDir, r.archiveBasename);
    const key = `weehawk/backups/u${userId}/${contextId}/${r.archiveBasename}`;
    try {
      const { bucket, key: uploadedKey } =
        await this.s3Service.uploadLocalFile(
          userId,
          trimmed,
          localPath,
          key,
        );
      return {
        success: true,
        output: `${r.output}\nUploaded to s3://${bucket}/${uploadedKey}`,
      };
    } catch (e) {
      return {
        success: false,
        output: `${r.output}\nS3 upload failed: ${getErrorMessage(e)}`,
      };
    }
  }

  /**
   * One-off backup trigger from the service details UI.
   * Mirrors the same execution flow as webhooks/cron jobs:
   * - run volume/db backup on the server (temp folder)
   * - upload produced archive to S3 (if configured)
   */
  async runServiceBackupNow(
    userId: number,
    serviceId: number,
    dto: RunServiceBackupDto,
  ): Promise<{ ok: boolean; action: RunServiceBackupDto['action']; output: string }> {
    await this.assertServiceOwnedByUser(serviceId, userId);
    const contextId = `manual-service-${serviceId}-${Date.now()}`;
    const profileName = dto.backupS3ProfileName?.trim();
    if (!profileName) {
      throw new BadRequestException('backupS3ProfileName is required.');
    }

    let destDir: string | null = null;
    try {
      await this.s3Service.assertProfileExists(profileName);
      destDir = await createBackupTempDir();

      if (dto.action === 'volume_backup') {
        const volumeSource = dto.volumeSource?.trim();
        if (!volumeSource) {
          throw new BadRequestException('volumeSource is required for volume backup.');
        }

        const r = await this.executorService.backupDockerVolume(
          volumeSource,
          destDir,
        );
        const final = await this.finalizeBackupWithS3(
          userId,
          contextId,
          profileName,
          destDir,
          r,
        );
        return { ok: final.success, action: dto.action, output: final.output.slice(0, 8000) };
      }

      if (dto.action === 'database_backup') {
        if (!dto.databaseBackupConfig) {
          throw new BadRequestException('databaseBackupConfig is required for database backup.');
        }
        const cfg = dto.databaseBackupConfig as unknown as DatabaseBackupConfig;
        const r = await this.executorService.backupDatabaseStructured(
          serviceId,
          cfg,
          destDir,
        );
        const final = await this.finalizeBackupWithS3(
          userId,
          contextId,
          profileName,
          destDir,
          r,
        );
        return { ok: final.success, action: dto.action, output: final.output.slice(0, 8000) };
      }

      // Should be unreachable due to DTO validation, but keeps TS safe.
      throw new BadRequestException('Unsupported backup action.');
    } catch (e) {
      const msg = getErrorMessage(e).slice(0, 8000);
      return { ok: false, action: dto.action, output: msg };
    } finally {
      if (destDir) {
        await removeBackupTempDir(destDir).catch(() => {
          /* best effort cleanup */
        });
      }
    }
  }

  /**
   * Import a database dump or volume backup archive from multipart upload; runs on the host like backup jobs.
   */
  async runServiceImportBackup(
    userId: number,
    serviceId: number,
    file: Express.Multer.File,
    action: 'import_database' | 'import_volume',
    databaseBackupConfigJson?: string,
    volumeSource?: string,
  ): Promise<{ ok: boolean; output: string }> {
    await this.assertServiceOwnedByUser(serviceId, userId);
    if (!file || (!(file as { buffer?: Buffer }).buffer?.length && !file.path)) {
      throw new BadRequestException('file is required.');
    }
    const buf = (file as { buffer?: Buffer }).buffer;
    if (buf && buf.length === 0) {
      throw new BadRequestException('Empty file.');
    }
    const safeName =
      path.basename(file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_') ||
      'upload.bin';
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-import-'));
    const tmpPath = path.join(tmpDir, safeName);
    try {
      if (buf?.length) {
        await fs.writeFile(tmpPath, buf);
      } else if (file.path) {
        await fs.copyFile(file.path, tmpPath);
      } else {
        throw new BadRequestException('Could not read uploaded file.');
      }

      if (action === 'import_volume') {
        const vol = volumeSource?.trim();
        if (!vol) {
          throw new BadRequestException('volumeSource is required.');
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(vol)) {
          throw new BadRequestException('Invalid volume name.');
        }
        const r = await this.executorService.importDockerVolume(vol, tmpPath);
        return { ok: r.success, output: r.output };
      }

      if (action === 'import_database') {
        const raw = databaseBackupConfigJson?.trim();
        if (!raw) {
          throw new BadRequestException('databaseBackupConfig JSON is required.');
        }
        let cfg: DatabaseBackupConfig;
        try {
          cfg = JSON.parse(raw) as DatabaseBackupConfig;
        } catch {
          throw new BadRequestException('Invalid databaseBackupConfig JSON.');
        }
        cfg.backupFormat = resolveBackupFormat(cfg.engine, cfg.backupFormat);
        const r = await this.executorService.importDatabaseStructured(
          serviceId,
          cfg,
          tmpPath,
        );
        return { ok: r.success, output: r.output };
      }

      throw new BadRequestException('Unsupported import action.');
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      return { ok: false, output: getErrorMessage(e).slice(0, 8000) };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Import from an object already stored in S3 (downloads to a temp file, then same path as multipart import).
   */
  async runServiceImportBackupFromS3(
    serviceId: number,
    dto: ImportServiceBackupFromS3Dto,
    userId: number,
  ): Promise<{ ok: boolean; output: string }> {
    await this.assertServiceOwnedByUser(serviceId, userId);
    const profile = dto.backupS3ProfileName.trim();
    const key = dto.s3Key.trim();
    if (!profile || !key) {
      throw new BadRequestException('backupS3ProfileName and s3Key are required.');
    }
    if (dto.action === 'import_volume') {
      if (!key.toLowerCase().endsWith('.tar.gz')) {
        throw new BadRequestException(
          'Volume import requires an object key ending with .tar.gz',
        );
      }
    }
    const rawBase = path.basename(key.replace(/\\/g, '/')) || 'import.bin';
    const safeName =
      rawBase.replace(/[^a-zA-Z0-9._-]/g, '_') || 'import.bin';
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-import-s3-'));
    const tmpPath = path.join(tmpDir, safeName);
    try {
      await this.s3Service.downloadObjectToFile(userId, profile, key, tmpPath);
      const st = await fs.stat(tmpPath);
      if (st.size === 0) {
        throw new BadRequestException('Downloaded object is empty.');
      }

      if (dto.action === 'import_volume') {
        const vol = dto.volumeSource?.trim();
        if (!vol) {
          throw new BadRequestException('volumeSource is required.');
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(vol)) {
          throw new BadRequestException('Invalid volume name.');
        }
        const r = await this.executorService.importDockerVolume(vol, tmpPath);
        return { ok: r.success, output: r.output };
      }

      if (dto.action === 'import_database') {
        const raw = dto.databaseBackupConfig?.trim();
        if (!raw) {
          throw new BadRequestException('databaseBackupConfig JSON is required.');
        }
        let cfg: DatabaseBackupConfig;
        try {
          cfg = JSON.parse(raw) as DatabaseBackupConfig;
        } catch {
          throw new BadRequestException('Invalid databaseBackupConfig JSON.');
        }
        cfg.backupFormat = resolveBackupFormat(cfg.engine, cfg.backupFormat);
        const r = await this.executorService.importDatabaseStructured(
          serviceId,
          cfg,
          tmpPath,
        );
        return { ok: r.success, output: r.output };
      }

      throw new BadRequestException('Unsupported import action.');
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      return { ok: false, output: getErrorMessage(e).slice(0, 8000) };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async startService(id: number, userId: number) {
    await this.assertServiceOwnedByUser(id, userId);
    return await this.executorService.startContainers(id);
  }

  async getRuntimeStatus(id: number, userId: number) {
    await this.assertServiceOwnedByUser(id, userId);
    return await this.executorService.getRuntimeStatus(id);
  }

  async getServiceVolumes(id: number, userId: number) {
    await this.assertServiceOwnedByUser(id, userId);
    return await this.executorService.getServiceVolumeMounts(id);
  }

  async findAll(_userId: number) {
    const rows = await this.serviceRepository.find({
      where: { project: { userId: _userId } },
      relations: ['project', 'remoteServer'],
      order: { createdAt: 'DESC' },
    });
    return Promise.all(rows.map((s) => this.withMagicTraefikMeUrl(s)));
  }

  async findByProjectId(projectId: number, userId: number) {
    await this.assertProjectOwnedByUser(projectId, userId);
    const rows = await this.serviceRepository.find({
      where: { project: { id: projectId } },
      relations: ['project', 'remoteServer'],
      order: { createdAt: 'DESC' },
    });
    return Promise.all(rows.map((s) => this.withMagicTraefikMeUrl(s)));
  }

  async findByProjectIdPaginated(
    projectId: number,
    page: number,
    limit: number,
    q: string | undefined,
    userId: number,
  ) {
    await this.assertProjectOwnedByUser(projectId, userId);
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 8));
    const trimmed = (q ?? '').trim().toLowerCase();

    const countQb = this.serviceRepository
      .createQueryBuilder('service')
      .innerJoin('service.project', 'project')
      .where('project.id = :projectId', { projectId });

    if (trimmed) {
      countQb.andWhere(
        '(LOWER(service.name) LIKE :q OR LOWER(COALESCE(service.description, \'\')) LIKE :q)',
        { q: `%${trimmed}%` },
      );
    }
    const total = await countQb.getCount();

    const dataQb = this.serviceRepository
      .createQueryBuilder('service')
      .leftJoinAndSelect('service.project', 'project')
      .leftJoinAndSelect('service.remoteServer', 'remoteServer')
      .where('project.id = :projectId', { projectId });

    if (trimmed) {
      dataQb.andWhere(
        '(LOWER(service.name) LIKE :q OR LOWER(COALESCE(service.description, \'\')) LIKE :q)',
        { q: `%${trimmed}%` },
      );
    }

    const data = await dataQb
      .orderBy('service.createdAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getMany();

    const enriched = await Promise.all(
      data.map((s) => this.withMagicTraefikMeUrl(s)),
    );

    return {
      data: enriched,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  private async assertDeployRemoteServer(
    remoteId: number,
    projectUserId: number | null,
  ): Promise<void> {
    const rs = await this.remoteServerRepository.findOneBy({ id: remoteId });
    if (!rs) {
      throw new BadRequestException('Remote server not found');
    }
    if (rs.serverRole === 'build') {
      throw new BadRequestException(
        'That host is a build-only server. Pick a deploy server to run containers, or change its role under Remote servers.',
      );
    }
    if (isLoopbackSshHost(rs.host)) {
      throw new BadRequestException(
        'That SSH host is the local machine (loopback). It can only be used for image builds — pick a real remote deploy server to run containers.',
      );
    }
    this.assertRemoteServerBelongsToProjectOwner(rs, projectUserId);
  }

  private async assertBuildRemoteServer(
    remoteId: number,
    projectUserId: number | null,
  ): Promise<void> {
    const rs = await this.remoteServerRepository.findOneBy({ id: remoteId });
    if (!rs) {
      throw new BadRequestException('Remote server not found');
    }
    if (rs.serverRole !== 'build') {
      throw new BadRequestException(
        'Only hosts marked as build servers can be used as the dedicated image-build target.',
      );
    }
    this.assertRemoteServerBelongsToProjectOwner(rs, projectUserId);
  }

  /** Same rules as {@link RemoteServersService.assertRemoteServerMatchesProject} but user-facing BadRequest for form/API. */
  private assertRemoteServerBelongsToProjectOwner(
    _rs: RemoteServer,
    _projectUserId: number | null,
  ): void {
    return;
  }

  async findOne(id: number) {
    const service = await this.serviceRepository.findOne({ 
      where: { id },
      relations: ['project', 'remoteServer', 'buildRemoteServer'] 
    });
    if (!service) throw new NotFoundException(`Service #${id} not found`);
    return service;
  }

  /**
   * Foreign keys for Docker-over-SSH (deploy / optional build). Read via query so executor does not rely on @RelationId hydration.
   * Uses fixed SQL aliases and lowercases keys — PostgreSQL returns unquoted aliases lowercase, which previously broke `pick('buildRemoteServerId')`.
   */
  async getDockerSshTargetIds(serviceId: number): Promise<{
    remoteServerId: number | null;
    buildRemoteServerId: number | null;
    buildOnLocalDockerHost: boolean;
  }> {
    const raw = (await this.serviceRepository
      .createQueryBuilder('s')
      .select('s.remoteServerId', 'wh_rid')
      .addSelect('s.buildRemoteServerId', 'wh_bid')
      .addSelect('s.buildOnLocalDockerHost', 'wh_local')
      .where('s.id = :id', { id: serviceId })
      .getRawOne()) as Record<string, unknown> | undefined;
    const n = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const x = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(x) ? x : null;
    };
    const asBool = (v: unknown): boolean =>
      v === true || v === 't' || v === 1 || v === '1';
    if (!raw) {
      return { remoteServerId: null, buildRemoteServerId: null, buildOnLocalDockerHost: false };
    }
    const byLower = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      remoteServerId: n(byLower['wh_rid']),
      buildRemoteServerId: n(byLower['wh_bid']),
      buildOnLocalDockerHost: asBool(byLower['wh_local']),
    };
  }

  /**
   * Removes GitHub/GitLab repo hooks registered for auto-deploy (best effort).
   */
  private async deleteAutoDeployExternalHooksIfAny(service: Service): Promise<void> {
    if (
      service.autoDeployGithubHookId != null &&
      service.autoDeployGitProvider === 'github' &&
      service.autoDeployRepoId
    ) {
      const parsed = ServicesService.parseGithubRepoId(service.autoDeployRepoId);
      if (parsed) {
        try {
          await this.gitService.deleteGithubRepoWebhook(
            parsed.installationId,
            parsed.fullName,
            service.autoDeployGithubHookId,
          );
          this.log.log(
            `Service delete: removed GitHub webhook #${service.autoDeployGithubHookId} for ${parsed.fullName}`,
          );
        } catch (e) {
          this.log.warn(
            `Service delete: GitHub hook cleanup failed: ${getErrorMessage(e)}`,
          );
        }
      }
    }
    if (
      service.autoDeployGitlabHookId != null &&
      service.autoDeployGitlabHookProjectId != null &&
      service.autoDeployGitProvider === 'gitlab'
    ) {
      try {
        await this.gitService.deleteGitlabProjectWebhook(
          service.autoDeployGitlabHookProjectId,
          service.autoDeployGitlabHookId,
        );
        this.log.log(
          `Service delete: removed GitLab hook #${service.autoDeployGitlabHookId} for project ${service.autoDeployGitlabHookProjectId}`,
        );
      } catch (e) {
        this.log.warn(
          `Service delete: GitLab hook cleanup failed: ${getErrorMessage(e)}`,
        );
      }
    }
  }

  async remove(id: number, userId: number) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    await this.deleteAutoDeployExternalHooksIfAny(service);
    await this.webhooksService.removeAllForService(userId, id);
    await this.executorService.stopAndRemove(id);
    await this.removeManagedSecretsForService(service.dockerConfig || '');
    await this.serviceRepository.remove(service);
    return { success: true };
  }

  async update(id: number, updateServiceDto: UpdateServiceDto, userId: number) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    const yamlEnvBefore = {
      dockerConfig: service.dockerConfig ?? '',
      env: service.env ?? '',
    };
    if (updateServiceDto.remoteServerId !== undefined) {
      if (updateServiceDto.remoteServerId !== null) {
        await this.assertDeployRemoteServer(
          updateServiceDto.remoteServerId,
          null,
        );
      }
    }
    if (
      updateServiceDto.buildOnLocalDockerHost === true &&
      updateServiceDto.buildRemoteServerId !== undefined &&
      updateServiceDto.buildRemoteServerId !== null
    ) {
      throw new BadRequestException(
        'Cannot set a dedicated build host when building on this server (API). Clear the build host or turn off “build on this server”.',
      );
    }
    if (updateServiceDto.buildRemoteServerId !== undefined) {
      if (updateServiceDto.buildRemoteServerId !== null) {
        await this.assertBuildRemoteServer(
          updateServiceDto.buildRemoteServerId,
          null,
        );
      }
    }
    if (updateServiceDto.registryPushImage !== undefined) {
      if (
        updateServiceDto.registryPushImage != null &&
        String(updateServiceDto.registryPushImage).trim() !== ''
      ) {
        this.validateDockerImageRef(String(updateServiceDto.registryPushImage));
      }
      if (service.composeType !== composeType.APPLICATION) {
        throw new BadRequestException(
          'registryPushImage applies only to application (Swarm) services.',
        );
      }
    }

    const {
      remoteServerId: remotePatch,
      buildRemoteServerId: buildPatch,
      registryPushImage: registryPushPatch,
      ...mergeFields
    } = updateServiceDto;
    const updated = this.serviceRepository.merge(service, mergeFields);

    // @RelationId fields are not persisted by merge/save; set ManyToOne refs so FK columns update.
    if (remotePatch !== undefined) {
      updated.remoteServer =
        remotePatch === null
          ? null
          : await this.remoteServerRepository.findOneByOrFail({ id: remotePatch });
    }
    if (buildPatch !== undefined) {
      updated.buildRemoteServer =
        buildPatch === null
          ? null
          : await this.remoteServerRepository.findOneByOrFail({ id: buildPatch });
      if (buildPatch !== null) {
        updated.buildOnLocalDockerHost = false;
      }
    }
    if (updated.buildOnLocalDockerHost === true) {
      updated.buildRemoteServer = null;
    }

    if (registryPushPatch !== undefined && updated.composeType === composeType.APPLICATION) {
      updated.dockerConfig = this.mergeRegistryPushHeader(
        updated.dockerConfig || '',
        registryPushPatch,
      );
    }

    if (updateServiceDto.traefikRoutes !== undefined && Array.isArray(updateServiceDto.traefikRoutes)) {
      const seen = new Set<string>();
      for (const r of updateServiceDto.traefikRoutes) {
        const name = (r?.router ?? '').trim().toLowerCase();
        if (!name) continue;
        if (seen.has(name)) {
          throw new BadRequestException(
            'Each Traefik route must have a unique router name. Duplicate names would overwrite labels on deploy.',
          );
        }
        seen.add(name);
      }
    }

    const shouldRefreshAppCompose =
      updated.composeType === composeType.APPLICATION &&
      (updateServiceDto.domains !== undefined ||
        updateServiceDto.traefikRoutes !== undefined ||
        updateServiceDto.magicTraefikMeIpv4 !== undefined ||
        registryPushPatch !== undefined ||
        updateServiceDto.buildOnLocalDockerHost !== undefined) &&
      (updated.dockerConfig || '').trim().length > 0;
    if (shouldRefreshAppCompose) {
      updated.dockerConfig = await this.composeApplicationDockerConfigForService(updated);
    }

    this.assertRegistryForLocalBuildOnApiRemoteDeploy(
      updated.composeType,
      updated.remoteServerId ?? null,
      updated.buildOnLocalDockerHost === true,
      updated.dockerConfig || '',
      registryPushPatch,
    );

    const saved = await this.serviceRepository.save(updated);
    this.mirrorDeployHostAfterYamlOrEnvChangeIfNeeded(yamlEnvBefore, saved, userId);
    const hydrated =
      (await this.serviceRepository.findOne({
        where: { id: saved.id },
        relations: ['project', 'remoteServer', 'buildRemoteServer'],
      })) ?? saved;
    return this.withMagicTraefikMeUrl(hydrated);
  }


  async shutdownService(id: number, userId: number) {
    await this.assertServiceOwnedByUser(id, userId);
    return await this.executorService.shutdown(id);
  }

  /**
   * Generate database stack YAML from form fields → `dockerConfig`.
   * Credentials are stored in the service environment and referenced from YAML as `${VAR}`.
   */
  async applyDatabase(
    id: number,
    engine: DatabaseEngine,
    dto: DatabaseSetupDto,
    userId: number,
  ) {
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.DATABASES) {
      throw new BadRequestException(
        'This service is not a database-type service.',
      );
    }
    const raw = (service.dockerConfig || '').trim();
    const engineMatch = raw.match(/^\s*#\s*engine:\s*(\w+)/m);
    if (engineMatch && engineMatch[1] !== engine) {
      throw new BadRequestException(
        `This service is not configured for ${engine} (engine mismatch).`,
      );
    }
    const yamlEnvBefore = {
      dockerConfig: service.dockerConfig ?? '',
      env: service.env ?? '',
    };
    const normalized = this.normalizeDatabaseSetupInput(engine, dto);
    const safeDb = this.databaseGenerator.sanitizeDbName(normalized.dbName);
    const allCredentials = this.credentialsForEngine(engine, safeDb, normalized);
    const plainEnvKeys = Object.keys(allCredentials).filter(
      (k) => String(allCredentials[k] ?? '').trim().length > 0,
    );
    const plainEnv = Object.fromEntries(
      Object.entries(allCredentials).filter(
        ([, v]) => String(v ?? '').trim().length > 0,
      ),
    );
    try {
      service.dockerConfig = this.databaseGenerator.buildDatabaseDockerConfig(
        engine,
        normalized.dbName,
        dto.replicas ?? 1,
        dto.publishPort,
        dto.image,
        normalized.volumePath,
        plainEnvKeys,
      );
    } catch (e) {
      if (e instanceof Error && /Invalid .* image reference/.test(e.message)) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
    service.env = this.mergeCredentialsIntoEnv(
      this.removeManagedDbEnvKeys(service.env || ''),
      plainEnv,
    );
    const saved = await this.serviceRepository.save(service);
    this.mirrorDeployHostAfterYamlOrEnvChangeIfNeeded(yamlEnvBefore, saved, userId);
    return saved;
  }

  async applyPostgresDatabase(id: number, dto: DatabaseSetupDto, userId: number) {
    return this.applyDatabase(id, 'postgres', dto, userId);
  }

  /**
   * Regenerate stack YAML with optional new host port and/or replicas.
   * Does not change credentials in env.
   */
  async updateDatabaseStack(
    id: number,
    engine: DatabaseEngine,
    dto: PostgresStackUpdateDto,
    userId: number,
  ) {
    if (dto.publishPort === undefined && dto.replicas === undefined) {
      return this.assertServiceOwnedByUser(id, userId);
    }
    const service = await this.assertServiceOwnedByUser(id, userId);
    if (service.composeType !== composeType.DATABASES) {
      throw new BadRequestException(
        'This service is not a database-type service.',
      );
    }
    const raw = (service.dockerConfig || '').trim();
    if (!new RegExp(`#\\s*engine:\\s*${engine}`).test(raw)) {
      throw new BadRequestException(
        `This service is not configured for ${engine}.`,
      );
    }
    if (!raw.includes('services:')) {
      throw new BadRequestException(
        `No stack file yet. Configure ${engine} first.`,
      );
    }
    let dbName: string | undefined;
    const dbNameHeader = raw.match(/^\s*#\s*dbName:\s*(.+)$/m)?.[1]?.trim();
    if (dbNameHeader) dbName = dbNameHeader;
    if (!dbName) {
      const m = raw.match(/^\s*services:\s*\r?\n\s*(\w+)\s*:/m);
      if (m?.[1]) dbName = m[1];
    }
    if (!dbName) {
      throw new BadRequestException(
        'Could not resolve database name from env or stack service key.',
      );
    }
    const currentReplicas = this.parseYamlReplicasFromConfig(raw);
    const currentPort = this.parsePublishPortFromYaml(
      raw,
      this.containerPortForEngine(engine),
    );
    const replicas =
      dto.replicas !== undefined
        ? Math.min(10, Math.max(1, Math.floor(dto.replicas)))
        : currentReplicas;
    const port =
      dto.publishPort !== undefined
        ? dto.publishPort === null
          ? null
          : dto.publishPort
        : currentPort;
    let currentImage =
      DatabaseGeneratorService.parseImageFromYaml(raw) ??
      this.defaultImageForEngine(engine);
    const currentVolumePath =
      raw.match(/^\s*#\s*volumePath:\s*(.+)$/m)?.[1]?.trim() ||
      this.databaseGenerator.defaultDataMount(engine);
    if (
      currentImage &&
      !DatabaseGeneratorService.IMAGE_REF_PATTERN.test(currentImage)
    ) {
      currentImage = this.defaultImageForEngine(engine);
    }
    const yamlEnvBefore = {
      dockerConfig: service.dockerConfig ?? '',
      env: service.env ?? '',
    };
    service.dockerConfig = this.databaseGenerator.buildDatabaseDockerConfig(
      engine,
      dbName,
      replicas,
      port,
      currentImage,
      currentVolumePath,
      this.credentialKeysForEngine(engine),
    );
    const saved = await this.serviceRepository.save(service);
    this.mirrorDeployHostAfterYamlOrEnvChangeIfNeeded(yamlEnvBefore, saved, userId);
    return saved;
  }

  async updatePostgresStack(
    id: number,
    dto: PostgresStackUpdateDto,
    userId: number,
  ) {
    return this.updateDatabaseStack(id, 'postgres', dto, userId);
  }

  private parsePublishPortFromYaml(
    config: string,
    containerPort: number,
  ): number | null {
    const m = config.match(new RegExp(`ports:\\s*\\n\\s*-\\s*"(\\d+):${containerPort}"`));
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isNaN(n) ? null : n;
  }

  private parseEnvLines(envString: string): Record<string, string> {
    const envVars: Record<string, string> = {};
    if (!envString) return envVars;
    envString.split('\n').forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          envVars[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
    return envVars;
  }

  private parseYamlReplicasFromConfig(config: string): number {
    const m = config.match(/replicas:\s*(\d+)/);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    if (Number.isNaN(n)) return 1;
    return Math.min(10, Math.max(1, n));
  }

  private removeManagedDbEnvKeys(existing: string): string {
    const patchKeys = new Set<string>([
      'POSTGRES_DB',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'MYSQL_DATABASE',
      'MYSQL_USER',
      'MYSQL_PASSWORD',
      'MYSQL_ROOT_PASSWORD',
      'MARIADB_DATABASE',
      'MARIADB_USER',
      'MARIADB_PASSWORD',
      'MARIADB_ROOT_PASSWORD',
      'MONGO_INITDB_DATABASE',
      'MONGO_INITDB_ROOT_USERNAME',
      'MONGO_INITDB_ROOT_PASSWORD',
      'REDIS_PASSWORD',
    ]);
    const lines = existing.split('\n');
    const out: string[] = [];

    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        out.push(line);
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) {
        out.push(line);
        continue;
      }
      const key = line.slice(0, eq).trim();
      if (patchKeys.has(key)) {
        continue;
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  /** Upserts env lines; preserves unknown keys and comments. */
  private mergeCredentialsIntoEnv(
    existing: string,
    credentials: Record<string, string>,
  ): string {
    const patchKeys = new Set<string>(Object.keys(credentials));
    const lines = existing.split('\n');
    const out: string[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        out.push(line);
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) {
        out.push(line);
        continue;
      }
      const key = line.slice(0, eq).trim();
      if (patchKeys.has(key)) {
        seen.add(key);
        out.push(`${key}=${credentials[key as keyof typeof credentials]}`);
      } else {
        out.push(line);
      }
    }
    for (const key of patchKeys) {
      if (!seen.has(key)) {
        out.push(`${key}=${credentials[key as keyof typeof credentials]}`);
      }
    }
    return out.join('\n');
  }

  private requiredEnvKeysForEngine(engine: DatabaseEngine): string[] {
    if (engine === 'postgres') return ['POSTGRES_PASSWORD'];
    if (engine === 'mysql') return ['MYSQL_ROOT_PASSWORD'];
    if (engine === 'mariadb') return ['MARIADB_ROOT_PASSWORD'];
    if (engine === 'mongodb') return ['MONGO_INITDB_ROOT_PASSWORD'];
    return ['REDIS_PASSWORD'];
  }

  private dbNameEnvCandidates(engine: DatabaseEngine): string[] {
    if (engine === 'postgres') return ['POSTGRES_DB'];
    if (engine === 'mysql') return ['MYSQL_DATABASE'];
    if (engine === 'mariadb') return ['MARIADB_DATABASE'];
    if (engine === 'mongodb') return ['MONGO_INITDB_DATABASE'];
    return [];
  }

  private credentialsForEngine(
    engine: DatabaseEngine,
    safeDb: string,
    input: {
      user?: string;
      pass?: string;
      rootUser?: string;
      rootPass?: string;
      password?: string;
    },
  ): Record<string, string> {
    if (engine === 'postgres') {
      return {
        POSTGRES_DB: safeDb,
        POSTGRES_USER: input.user as string,
        POSTGRES_PASSWORD: input.pass as string,
      };
    }
    if (engine === 'mysql') {
      return {
        MYSQL_DATABASE: safeDb,
        MYSQL_USER: input.user as string,
        MYSQL_PASSWORD: input.pass as string,
        MYSQL_ROOT_PASSWORD: input.rootPass as string,
      };
    }
    if (engine === 'mariadb') {
      return {
        MARIADB_DATABASE: safeDb,
        MARIADB_USER: input.user as string,
        MARIADB_PASSWORD: input.pass as string,
        MARIADB_ROOT_PASSWORD: input.rootPass as string,
      };
    }
    if (engine === 'mongodb') {
      return {
        MONGO_INITDB_DATABASE: safeDb,
        MONGO_INITDB_ROOT_USERNAME: input.rootUser as string,
        MONGO_INITDB_ROOT_PASSWORD: input.rootPass as string,
      };
    }
    return { REDIS_PASSWORD: input.password as string };
  }

  /** Env var names used in generated database stack YAML for the engine. */
  private credentialKeysForEngine(engine: DatabaseEngine): string[] {
    return Object.keys(
      this.credentialsForEngine(engine, 'ph', {
        user: 'u',
        pass: 'p',
        rootUser: 'ru',
        rootPass: 'rp',
        password: 'pw',
      }),
    );
  }

  private parseSecretRefsFromHeader(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*#\s*secret\.([A-Z0-9_]+):\s*(.+)\s*$/);
      if (!m) continue;
      out[m[1]] = m[2].trim();
    }
    return out;
  }

  /**
   * Managed app secrets: `# secret.KEY: name` plus `KEY_FILE: /run/secrets/name` in the service env
   * (needed when headers are missing or reformatted).
   */
  private parseApplicationSecretRefsFromDockerConfig(raw: string): Record<string, string> {
    const out: Record<string, string> = { ...this.parseSecretRefsFromHeader(raw) };
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(
        /^\s*([A-Za-z_][A-Za-z0-9_]*)_FILE:\s*\/run\/secrets\/(\S+)\s*$/,
      );
      if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
    }
    return out;
  }

  /** External Swarm secret names declared in the root `secrets:` block (before `networks:`). */
  private parseRootExternalSecretNamesFromApplicationCompose(raw: string): string[] {
    const lines = raw.split(/\r?\n/);
    const names: string[] = [];
    let i = 0;
    while (i < lines.length && !/^secrets:\s*$/.test(lines[i])) i++;
    if (i >= lines.length) return names;
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (/^networks:\s*$/.test(line)) break;
      if (/^[a-zA-Z].*:\s*$/.test(line)) break;
      const m = line.match(/^  ([a-zA-Z0-9_.-]+):\s*$/);
      if (m) {
        const next = lines[i + 1] ?? '';
        if (/^\s+external:\s*true\s*$/.test(next)) {
          names.push(m[1]);
          i += 2;
          continue;
        }
      }
      i++;
    }
    return names;
  }

  /**
   * When variables no longer reference a key (or the secret name changes), remove the
   * previous Swarm secret via `docker secret rm` (see `DockerSecretsService.remove`).
   * `force` detaches the secret from services first when Swarm reports it is still in use.
   */
  private async removeObsoleteManagedSecrets(
    previousConfig: string,
    newRefs: Record<string, string>,
  ): Promise<void> {
    const prev = previousConfig || '';
    const oldByKey = this.parseApplicationSecretRefsFromDockerConfig(prev);
    const newNames = new Set(Object.values(newRefs));
    const toRemove = new Set<string>();

    for (const [key, oldName] of Object.entries(oldByKey)) {
      if (!oldName) continue;
      if (newRefs[key] === oldName) continue;
      toRemove.add(oldName);
    }
    for (const name of this.parseRootExternalSecretNamesFromApplicationCompose(prev)) {
      if (!newNames.has(name)) toRemove.add(name);
    }

    const failures: string[] = [];
    for (const oldName of toRemove) {
      try {
        await this.dockerSecrets.removePrune(oldName);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${oldName} (${msg})`);
      }
    }
    if (failures.length) {
      throw new BadRequestException(
        `Failed to remove Docker secrets: ${failures.join(', ')}`,
      );
    }
  }

  private async removeManagedSecretsForService(rawConfig: string): Promise<void> {
    await this.removeObsoleteManagedSecrets(rawConfig || '', {});
  }

  private nonEmpty(v: string | undefined): string | null {
    const t = (v ?? '').trim();
    return t ? t : null;
  }

  private normalizeDatabaseSetupInput(engine: DatabaseEngine, dto: DatabaseSetupDto): {
    dbName: string;
    user?: string;
    pass?: string;
    rootUser?: string;
    rootPass?: string;
    password?: string;
    volumePath?: string;
  } {
    const dbName = this.nonEmpty(dto.dbName);
    const user = this.nonEmpty(dto.user);
    const pass = this.nonEmpty(dto.pass);
    const rootUser = this.nonEmpty(dto.rootUser);
    const rootPass = this.nonEmpty(dto.rootPass);
    const password = this.nonEmpty(dto.password);
    const volumePath = this.nonEmpty(dto.volumePath) ?? undefined;

    if (engine === 'postgres') {
      if (!dbName || !user || !pass) {
        throw new BadRequestException(
          'Postgres requires dbName, user, and pass.',
        );
      }
      return { dbName, user, pass, volumePath };
    }
    if (engine === 'mysql' || engine === 'mariadb') {
      if (!dbName || !user || !pass || !rootPass) {
        throw new BadRequestException(
          `${engine} requires dbName, user, pass, and rootPass.`,
        );
      }
      return { dbName, user, pass, rootPass, volumePath };
    }
    if (engine === 'mongodb') {
      if (!dbName || !rootUser || !rootPass) {
        throw new BadRequestException(
          'mongodb requires dbName, rootUser, and rootPass.',
        );
      }
      return { dbName, rootUser, rootPass, volumePath };
    }
    if (!password) {
      throw new BadRequestException('redis requires password.');
    }
    return { dbName: dbName ?? 'redis', password, volumePath };
  }

  private defaultImageForEngine(engine: DatabaseEngine): string {
    if (engine === 'postgres') return DatabaseGeneratorService.POSTGRES_DOCKER_IMAGE;
    if (engine === 'mysql') return DatabaseGeneratorService.MYSQL_DOCKER_IMAGE;
    if (engine === 'mariadb') return DatabaseGeneratorService.MARIADB_DOCKER_IMAGE;
    if (engine === 'mongodb') return DatabaseGeneratorService.MONGODB_DOCKER_IMAGE;
    return DatabaseGeneratorService.REDIS_DOCKER_IMAGE;
  }

  private containerPortForEngine(engine: DatabaseEngine): number {
    if (engine === 'postgres') return 5432;
    if (engine === 'mysql' || engine === 'mariadb') return 3306;
    if (engine === 'mongodb') return 27017;
    return 6379;
  }

  // ─── Auto-deploy ────────────────────────────────────────────────────────────

  /** Configure auto-deploy for an application service (authenticated). */
  async configureAutoDeploy(
    serviceId: number,
    userId: number,
    opts: {
      enabled: boolean;
      branch?: string;
      gitProvider?: string | null;
      repoId?: string | null;
    },
  ): Promise<{
    autoDeployEnabled: boolean;
    autoDeployBranch: string;
    autoDeployGitProvider: string | null;
    autoDeployRepoId: string | null;
  }> {
    const service = await this.assertServiceOwnedByUser(serviceId, userId);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException(
        'Auto-deploy is only available for application-type services.',
      );
    }

    const previous = {
      autoDeployEnabled: service.autoDeployEnabled,
      autoDeployBranch: service.autoDeployBranch ?? 'main',
      autoDeployGitProvider: service.autoDeployGitProvider ?? null,
      autoDeployRepoId: service.autoDeployRepoId ?? null,
      autoDeployGithubHookId: service.autoDeployGithubHookId ?? null,
      autoDeployGitlabHookId: service.autoDeployGitlabHookId ?? null,
      autoDeployGitlabHookProjectId: service.autoDeployGitlabHookProjectId ?? null,
    };

    service.autoDeployEnabled = opts.enabled;
    if (opts.branch !== undefined) {
      service.autoDeployBranch = opts.branch.trim() || 'main';
    }
    if (opts.gitProvider !== undefined) {
      service.autoDeployGitProvider = opts.gitProvider;
    }
    if (opts.repoId !== undefined) {
      service.autoDeployRepoId = opts.repoId;
    }

    await this.serviceRepository.save(service);

    try {
      await this.syncAutoDeployExternalHooks(service, previous);
    } catch (e) {
      service.autoDeployEnabled = previous.autoDeployEnabled;
      service.autoDeployBranch = previous.autoDeployBranch;
      service.autoDeployGitProvider = previous.autoDeployGitProvider;
      service.autoDeployRepoId = previous.autoDeployRepoId;
      service.autoDeployGithubHookId = previous.autoDeployGithubHookId;
      service.autoDeployGitlabHookId = previous.autoDeployGitlabHookId;
      service.autoDeployGitlabHookProjectId = previous.autoDeployGitlabHookProjectId;
      await this.serviceRepository.save(service);
      if (e instanceof HttpException) {
        throw e;
      }
      throw new BadRequestException(getErrorMessage(e));
    }

    try {
      await this.webhooksService.refreshGeneratedOnHostRedeployScriptsForService(
        serviceId,
      );
    } catch {
      /* best effort — auto-deploy toggle saved even if script refresh fails */
    }

    return {
      autoDeployEnabled: service.autoDeployEnabled,
      autoDeployBranch: service.autoDeployBranch,
      autoDeployGitProvider: service.autoDeployGitProvider ?? null,
      autoDeployRepoId: service.autoDeployRepoId ?? null,
    };
  }

  /**
   * Force-resync auto-deploy external hooks (GitHub/GitLab) after the local
   * redeploy webhook URL changes (e.g. token regenerate).
   * Deletes the stale hook on the provider and registers a fresh one
   * pointing to the current trigger URL.
   */
  async resyncAutoDeployHooks(
    serviceId: number,
    userId: number,
  ): Promise<{ updated: boolean }> {
    const service = await this.assertServiceOwnedByUser(serviceId, userId);

    if (!service.autoDeployEnabled || !service.autoDeployGitProvider) {
      return { updated: false };
    }

    const previous = {
      autoDeployEnabled: service.autoDeployEnabled,
      autoDeployGitProvider: service.autoDeployGitProvider,
      autoDeployRepoId: service.autoDeployRepoId ?? null,
      autoDeployGithubHookId: service.autoDeployGithubHookId ?? null,
      autoDeployGitlabHookId: service.autoDeployGitlabHookId ?? null,
      autoDeployGitlabHookProjectId: service.autoDeployGitlabHookProjectId ?? null,
    };

    // Delete existing external hooks (force clean)
    if (
      previous.autoDeployGithubHookId != null &&
      previous.autoDeployGitProvider === 'github' &&
      previous.autoDeployRepoId
    ) {
      const parsed = ServicesService.parseGithubRepoId(previous.autoDeployRepoId);
      if (parsed) {
        try {
          await this.gitService.deleteGithubRepoWebhook(
            parsed.installationId,
            parsed.fullName,
            previous.autoDeployGithubHookId,
          );
        } catch (e) {
          this.log.warn(`resync: failed to delete old GitHub hook: ${getErrorMessage(e)}`);
        }
      }
      service.autoDeployGithubHookId = null;
      await this.serviceRepository.save(service);
    }

    if (
      previous.autoDeployGitlabHookId != null &&
      previous.autoDeployGitlabHookProjectId != null &&
      previous.autoDeployGitProvider === 'gitlab'
    ) {
      try {
        await this.gitService.deleteGitlabProjectWebhook(
          previous.autoDeployGitlabHookProjectId,
          previous.autoDeployGitlabHookId,
        );
      } catch (e) {
        this.log.warn(`resync: failed to delete old GitLab hook: ${getErrorMessage(e)}`);
      }
      service.autoDeployGitlabHookId = null;
      service.autoDeployGitlabHookProjectId = null;
      await this.serviceRepository.save(service);
    }

    // Re-register with the new trigger URL
    const triggerUrl = await this.resolveRemoteRedeployWebhookTriggerUrl(service);
    if (!triggerUrl) {
      this.log.warn(
        `resync: service #${service.id} has no remote redeploy webhook with a trigger URL.`,
      );
      return { updated: false };
    }

    if (service.autoDeployGitProvider === 'github' && service.autoDeployRepoId) {
      const parsed = ServicesService.parseGithubRepoId(service.autoDeployRepoId);
      if (parsed) {
        const hookId = await this.gitService.createGithubRepoWebhook({
          installationId: parsed.installationId,
          repoFullName: parsed.fullName,
          url: triggerUrl,
        });
        service.autoDeployGithubHookId = hookId;
        await this.serviceRepository.save(service);
        this.log.log(
          `resync: registered GitHub webhook #${hookId} for ${parsed.fullName} → ${triggerUrl}`,
        );
      }
    }

    if (
      service.autoDeployGitProvider === 'gitlab' &&
      ServicesService.isNumericGitlabProjectRepoId(service.autoDeployRepoId)
    ) {
      const projectId = parseInt(service.autoDeployRepoId!.trim(), 10);
      const hookId = await this.gitService.createGitlabPushWebhook({
        projectId,
        url: triggerUrl,
        token: randomBytes(24).toString('hex'),
      });
      service.autoDeployGitlabHookId = hookId;
      service.autoDeployGitlabHookProjectId = projectId;
      await this.serviceRepository.save(service);
      this.log.log(
        `resync: registered GitLab hook #${hookId} for project ${projectId} → ${triggerUrl}`,
      );
    }

    return { updated: true };
  }

  private static isNumericGitlabProjectRepoId(repoId: string | null | undefined): boolean {
    if (repoId == null || repoId === '') return false;
    const n = parseInt(repoId.trim(), 10);
    return Number.isFinite(n) && n > 0 && String(n) === repoId.trim();
  }

  /**
   * Parses `"installationId:owner/repo"` → `{ installationId, fullName }`.
   */
  private static parseGithubRepoId(
    repoId: string,
  ): { installationId: number; fullName: string } | null {
    const sep = repoId.indexOf(':');
    if (sep < 0) return null;
    const iid = parseInt(repoId.slice(0, sep), 10);
    const fn = repoId.slice(sep + 1).trim();
    if (!Number.isFinite(iid) || iid <= 0 || !fn) return null;
    return { installationId: iid, fullName: fn };
  }

  /**
   * Finds the existing redeploy webhook that runs on the remote server for this service.
   * Returns the webhook's public trigger URL (on the remote deploy host).
   */
  private async resolveRemoteRedeployWebhookTriggerUrl(
    service: Service,
  ): Promise<string | null> {
    const webhooks = await this.webhooksService.findWebhooksForService(
      service.id,
      service.project.userId,
    );
    for (const w of webhooks) {
      if (
        w.serviceAction === 'docker_command' &&
        w.remoteServerId != null &&
        w.remoteTriggerUrl
      ) {
        return w.remoteTriggerUrl;
      }
    }
    return null;
  }

  /**
   * When auto-deploy is toggled, registers or removes webhooks on GitHub/GitLab
   * pointing directly to the **remote server's webhook agent** — not the local API process.
   * This way auto-deploy works even when the user's PC is off.
   */
  private async syncAutoDeployExternalHooks(
    service: Service,
    previous: {
      autoDeployEnabled: boolean;
      autoDeployGitProvider: string | null;
      autoDeployRepoId: string | null;
      autoDeployGithubHookId: number | null;
      autoDeployGitlabHookId: number | null;
      autoDeployGitlabHookProjectId: number | null;
    },
  ): Promise<void> {
    const disabling = previous.autoDeployEnabled && !service.autoDeployEnabled;
    const providerChanged =
      (previous.autoDeployGitProvider ?? null) !==
      (service.autoDeployGitProvider ?? null);
    const repoChanged =
      (previous.autoDeployRepoId ?? null) !==
      (service.autoDeployRepoId ?? null);
    const shouldClean = disabling || providerChanged || repoChanged;

    // ── Remove old GitHub hook ──
    if (
      shouldClean &&
      previous.autoDeployGithubHookId != null &&
      previous.autoDeployGitProvider === 'github' &&
      previous.autoDeployRepoId
    ) {
      const parsed = ServicesService.parseGithubRepoId(previous.autoDeployRepoId);
      if (parsed) {
        try {
          await this.gitService.deleteGithubRepoWebhook(
            parsed.installationId,
            parsed.fullName,
            previous.autoDeployGithubHookId,
          );
        } catch (e) {
          this.log.warn(`Failed to delete GitHub repo hook: ${getErrorMessage(e)}`);
        }
      }
      service.autoDeployGithubHookId = null;
      await this.serviceRepository.save(service);
    }

    // ── Remove old GitLab hook ──
    if (
      shouldClean &&
      previous.autoDeployGitlabHookId != null &&
      previous.autoDeployGitlabHookProjectId != null &&
      previous.autoDeployGitProvider === 'gitlab'
    ) {
      try {
        await this.gitService.deleteGitlabProjectWebhook(
          previous.autoDeployGitlabHookProjectId,
          previous.autoDeployGitlabHookId,
        );
      } catch (e) {
        this.log.warn(`Failed to delete GitLab project hook: ${getErrorMessage(e)}`);
      }
      service.autoDeployGitlabHookId = null;
      service.autoDeployGitlabHookProjectId = null;
      await this.serviceRepository.save(service);
    }

    if (!service.autoDeployEnabled) {
      return;
    }

    // Resolve the remote webhook trigger URL (the URL on the remote deploy server)
    const triggerUrl = await this.resolveRemoteRedeployWebhookTriggerUrl(service);
    if (!triggerUrl) {
      this.log.warn(
        `Auto-deploy: service #${service.id} has no remote redeploy webhook with a public trigger URL. ` +
          'Create a webhook with a deploy server first so GitHub/GitLab can reach it.',
      );
      return;
    }

    // ── Register GitHub repo hook ──
    if (
      service.autoDeployGitProvider === 'github' &&
      service.autoDeployRepoId
    ) {
      const parsed = ServicesService.parseGithubRepoId(service.autoDeployRepoId);
      if (parsed && service.autoDeployGithubHookId == null) {
        const hookId = await this.gitService.createGithubRepoWebhook({
          installationId: parsed.installationId,
          repoFullName: parsed.fullName,
          url: triggerUrl,
        });
        service.autoDeployGithubHookId = hookId;
        await this.serviceRepository.save(service);
        this.log.log(
          `Auto-deploy: registered GitHub webhook #${hookId} for ${parsed.fullName} → ${triggerUrl}`,
        );
      }
    }

    // ── Register GitLab project hook ──
    if (
      service.autoDeployGitProvider === 'gitlab' &&
      ServicesService.isNumericGitlabProjectRepoId(service.autoDeployRepoId)
    ) {
      const projectId = parseInt(service.autoDeployRepoId!.trim(), 10);
      if (
        service.autoDeployGitlabHookId == null ||
        service.autoDeployGitlabHookProjectId !== projectId
      ) {
        const hookId = await this.gitService.createGitlabPushWebhook({
          projectId,
          url: triggerUrl,
          token: randomBytes(24).toString('hex'),
        });
        service.autoDeployGitlabHookId = hookId;
        service.autoDeployGitlabHookProjectId = projectId;
        await this.serviceRepository.save(service);
        this.log.log(
          `Auto-deploy: registered GitLab hook #${hookId} for project ${projectId} → ${triggerUrl}`,
        );
      }
    }
  }

  /**
   * Resolve the authenticated HTTPS clone URL for a GitLab project (token embedded).
   * Used by the webhook env writer so the remote host can `git clone` private repos.
   */
  async resolveGitlabProjectCloneUrl(projectId: number): Promise<string | null> {
    try {
      const info = await this.gitService.gitlabCloneInfoForProject(projectId);
      return info.cloneUrl || null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve an authenticated HTTPS clone URL for a manual GitLab URL.
   * Injects the stored GitLab token when available (for private repos).
   */
  async resolveGitlabAuthenticatedUrl(httpUrl: string): Promise<string> {
    return this.gitService.resolveGitlabHttpCloneUrl(httpUrl);
  }

  /**
   * Return the GitHub App credentials (appId + PEM private key) so callers
   * can write them to a remote env for self-service token generation.
   */
  async getGithubAppCredentials(): Promise<{ appId: string; privateKeyPem: string } | null> {
    try {
      return await this.gitService.getGithubAppPublicCredentials();
    } catch {
      return null;
    }
  }

  /** For on-host tarball fallback when `git` is missing (GitLab API archive). */
  async getGitlabArchiveApiCredentials(): Promise<{
    apiBase: string;
    privateToken: string;
  } | null> {
    return this.gitService.getGitlabArchiveApiCredentials();
  }

  /** Read auto-deploy settings (authenticated). */
  async getAutoDeploySettings(serviceId: number, userId: number) {
    const service = await this.assertServiceOwnedByUser(serviceId, userId);
    return {
      autoDeployEnabled: service.autoDeployEnabled ?? false,
      autoDeployBranch: service.autoDeployBranch ?? 'main',
      autoDeployGitProvider: service.autoDeployGitProvider ?? null,
      autoDeployRepoId: service.autoDeployRepoId ?? null,
    };
  }

  /**
   * Called by {@link WebhooksService} when a redeploy webhook fires and the service
   * has auto-deploy enabled. Clones the repo → re-generates the stack → deploys.
   */
  async runAutoDeployCloneAndDeploy(
    serviceId: number,
    options?: { deployLogEmitter?: EventEmitter },
  ): Promise<{
    success: boolean;
    output: string;
  }> {
    const emit = (msg: string) =>
      emitDeployLog(options?.deployLogEmitter, msg);
    const service = await this.serviceRepository.findOne({
      where: { id: serviceId },
      relations: ['project', 'remoteServer', 'buildRemoteServer'],
    });
    if (!service) {
      return { success: false, output: `Service #${serviceId} not found.` };
    }
    if (!service.autoDeployEnabled) {
      return { success: false, output: 'Auto-deploy is not enabled.' };
    }

    const provider = service.autoDeployGitProvider;
    const repoId = service.autoDeployRepoId;
    const branch = service.autoDeployBranch || 'main';

    if (!provider || !repoId) {
      return {
        success: false,
        output: 'Auto-deploy git provider and repo id are not configured.',
      };
    }

    let cloneOptions: {
      gitlabProjectId?: number;
      githubInstallationId?: number;
      githubRepoFullName?: string;
      httpUrlToRepo?: string;
      branch?: string;
    };

    if (provider === 'github') {
      const sep = repoId.indexOf(':');
      if (sep < 0) {
        return {
          success: false,
          output:
            'Invalid GitHub auto-deploy repo id. Expected "installationId:owner/repo".',
        };
      }
      const installationId = parseInt(repoId.slice(0, sep), 10);
      const fullName = repoId.slice(sep + 1);
      cloneOptions = {
        githubInstallationId: installationId,
        githubRepoFullName: fullName,
        branch,
      };
    } else if (provider === 'gitlab') {
      const projectId = parseInt(repoId, 10);
      if (Number.isFinite(projectId) && projectId > 0) {
        cloneOptions = { gitlabProjectId: projectId, branch };
      } else {
        cloneOptions = { httpUrlToRepo: repoId, branch };
      }
    } else {
      return { success: false, output: `Unknown git provider: ${provider}` };
    }

    try {
      emit(`[auto-deploy] Resolving git clone source (${provider})…\n`);
      const { cloneUrl, branch: resolvedBranch } =
        await this.resolveApplicationGitCloneSource(cloneOptions);

      const deployDir = getServiceDeploymentDir(
        service.appName,
        this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
      );
      const sourceDir = path.join(deployDir, 'app-source');
      await fs.mkdir(deployDir, { recursive: true });

      emit(
        `[auto-deploy] Cloning ${provider} repo (branch: ${resolvedBranch ?? branch})…\n`,
      );
      await this.cloneGitRepository(
        cloneUrl,
        sourceDir,
        resolvedBranch ?? branch,
      );
      emit('[auto-deploy] Clone complete. Generating stack configuration…\n');

      await this.applyApplicationSourceFromDirectory(
        service,
        sourceDir,
        {},
        'repository',
      );
      emit('[auto-deploy] Stack configuration generated.\n');

      emit('[auto-deploy] Syncing files to deploy host…\n');
      const mirrorResult = await this.pushApplicationMirrorToDeployHostIfConfigured(service.id, 1);
      if (mirrorResult.status === 'failed') {
        const warnMsg = `Auto-deploy mirror sync failed for service #${service.id}: ${mirrorResult.message}`;
        this.log.warn(warnMsg);
        emit(`[auto-deploy] Warning: ${warnMsg}\n`);
      } else if (mirrorResult.status === 'synced') {
        emit('[auto-deploy] Files synced to deploy host.\n');
      } else {
        emit('[auto-deploy] No remote deploy host — building locally.\n');
      }

      emit('[auto-deploy] Starting build & deploy…\n');
      const result = await this.executorService.execute(service.id, 'redeploy', {
        deployLogEmitter: options?.deployLogEmitter,
      });
      if (!result.success) {
        return {
          success: false,
          output: result.output?.slice(0, 2000) || 'Deploy failed',
        };
      }

      await this.serviceRepository.update(service.id, {
        lastDeployedAt: new Date(),
      });
      emit('[auto-deploy] Deploy completed successfully.\n');
      this.log.log(
        `Auto-deploy: service #${service.id} deployed successfully.`,
      );
      return { success: true, output: 'Auto-deploy completed successfully.' };
    } catch (e) {
      const msg = getErrorMessage(e);
      this.log.error(
        `Auto-deploy failed for service #${service.id}: ${msg}`,
      );
      return { success: false, output: `Auto-deploy failed: ${msg}` };
    }
  }
}

export {
  writeWeehawkGeneratedDockerfile,
  resolveEffectiveDockerfileRel,
  WEEHAWK_GENERATED_DOCKERFILE_REL,
} from './weehawk-build-paths';