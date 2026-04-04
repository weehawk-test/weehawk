import {
  Injectable,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
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
import { createBackupTempDir, getServiceDeploymentDir, removeBackupTempDir } from './deployment-paths';
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
import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik/traefik.constants';

const execFileAsync = promisify(execFile);

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(RemoteServer)
    private readonly remoteServerRepository: Repository<RemoteServer>,
    @Inject(forwardRef(() => ExecutorService))
    private readonly executorService: ExecutorService,
    private readonly configService: ConfigService,
    private readonly databaseGenerator: DatabaseGeneratorService,
    private readonly dockerfileGenerator: DockerfileGeneratorService,
    private readonly dockerSecrets: DockerSecretsService,
    private readonly s3Service: S3Service,
    private readonly gitService: GitService,
    private readonly traefikService: TraefikService,
  ) {}

  async create(createServiceDto: CreateServiceDto) {
    const { projectId, appName, ...serviceData } = createServiceDto;
    const project = await this.projectRepository.findOneBy({ id: projectId });
    if (!project) throw new NotFoundException('Project not found');

    if (createServiceDto.remoteServerId != null) {
      const rs = await this.remoteServerRepository.findOneBy({
        id: createServiceDto.remoteServerId,
      });
      if (!rs) {
        throw new BadRequestException('Remote server not found');
      }
    }

    const uniqueAppName = `${appName}-${randomBytes(2).toString('hex')}`;
    const service = this.serviceRepository.create({
      ...serviceData,
      appName: uniqueAppName,
      project: project,
    });

    return await this.serviceRepository.save(service);
  }

  private parseConfigHeaderValue(config: string, key: string): string | null {
    const m = (config || '').match(new RegExp(`^\\s*#\\s*${key}:\\s*(.+)$`, 'm'));
    return m?.[1]?.trim() || null;
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
    secretRefs: Record<string, string>;
  } {
    const raw = service.dockerConfig || '';
    const sourceDir = this.parseConfigHeaderValue(raw, 'sourceDir') || 'app-source';
    const buildPath = this.parseConfigHeaderValue(raw, 'buildPath') || '.';
    const dockerfilePath = this.parseConfigHeaderValue(raw, 'dockerfilePath') || 'Dockerfile';
    const buildModeRaw = this.parseConfigHeaderValue(raw, 'buildMode') || 'dockerfile';
    const bm = (buildModeRaw || 'dockerfile').toLowerCase();
    const buildMode =
      bm === 'nixpacks' || bm === 'buildpacks' ? 'buildpacks' : 'dockerfile';

    const secretRefs = this.parseApplicationSecretRefsFromDockerConfig(raw);

    const envKeys: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*#\s*app\.store\.([A-Z0-9_]+):\s*env\s*$/i);
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

    if (deployModeHeader === 'image' || imageRefHeader) {
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
      secretRefs,
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

  private ensureTraefikExternalNetwork(
    network: { external: string[]; stack: string[] },
    service: Service,
  ): { external: string[]; stack: string[] } {
    const proxy = WEEHAWK_TRAEFIK_EXTERNAL_NETWORK;
    const hasHosts = this.collectServiceTraefikHosts(service).length > 0;
    if (!hasHosts) return network;
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
      entrypoint: string;
      routes: Array<{ router: string; rule: string; port: number }>;
    },
  ): string {
    if (!traefik?.routes?.length) return '';
    const lines: string[] = ['      labels:', '        - "traefik.enable=true"'];
    for (const r of traefik.routes) {
      const ruleEsc = this.escapeTraefikComposeLabelValue(r.rule);
      lines.push(`        - "traefik.http.routers.${r.router}.rule=${ruleEsc}"`);
      lines.push(
        `        - "traefik.http.routers.${r.router}.entrypoints=${traefik.entrypoint}"`,
      );
      lines.push(
        `        - "traefik.http.routers.${r.router}.tls.certresolver=${traefik.certResolver}"`,
      );
      lines.push(
        `        - "traefik.http.services.${r.router}.loadbalancer.server.port=${r.port}"`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private async buildTraefikIngressForCompose(
    service: Service,
    containerPort: number,
  ): Promise<
    | {
        certResolver: string;
        entrypoint: string;
        routes: Array<{ router: string; rule: string; port: number }>;
      }
    | undefined
  > {
    const settings = await this.traefikService.getSettings();
    const certResolver = (settings.certResolverName || 'letsencrypt').trim();
    const entrypoint = (settings.httpsEntrypoint || 'websecure').trim();
    const routes: Array<{ router: string; rule: string; port: number }> = [];

    if (service.traefikRoutes && service.traefikRoutes.length > 0) {
      for (const r of service.traefikRoutes) {
        const router = (r.router || '').trim().toLowerCase();
        if (!router) continue;
        const hosts = (r.hosts ?? [])
          .map((h) => this.sanitizeDomainForTraefikRule(h))
          .filter((x): x is string => Boolean(x));
        if (!hosts.length) continue;
        const rule = this.buildTraefikHostPathRule(hosts, r.pathPrefix);
        if (!rule) continue;
        const port =
          r.port != null && Number.isFinite(Number(r.port))
            ? Math.min(65535, Math.max(1, Math.floor(Number(r.port))))
            : containerPort;
        routes.push({ router, rule, port });
      }
    } else {
      const ruleDomains = (service.domains ?? [])
        .map((d) => this.sanitizeDomainForTraefikRule(d))
        .filter((x): x is string => Boolean(x));
      if (!ruleDomains.length) return undefined;
      const rule = this.buildTraefikHostPathRule(ruleDomains, null);
      routes.push({
        router: this.sanitizeTraefikRouterBase(service),
        rule,
        port: containerPort,
      });
    }

    if (!routes.length) return undefined;
    return { certResolver, entrypoint, routes };
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
    const imageName =
      args.deployMode === 'image' && args.imageRef?.trim()
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
      containerPort: args.containerPort,
      publishPort: args.publishPort,
      replicas: args.replicas,
      envKeys: args.envKeys,
      secretRefs: args.secretRefs,
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
    containerPort: number;
    publishPort?: number;
    replicas: number;
    envKeys: string[];
    secretRefs: Record<string, string>;
    network: { external: string[]; stack: string[] };
    traefik?: {
      certResolver: string;
      entrypoint: string;
      routes: Array<{ router: string; rule: string; port: number }>;
    };
  }): string {
    const ports =
      args.publishPort != null
        ? `    ports:\n      - "${args.publishPort}:${args.containerPort}"\n`
        : '';
    const envLines = args.envKeys.map((k) => `      ${k}: \${${k}}`);
    for (const [k, secretName] of Object.entries(args.secretRefs)) {
      envLines.push(`      ${k}_FILE: /run/secrets/${secretName}`);
    }
    const envSection = envLines.length ? `    environment:\n${envLines.join('\n')}\n` : '';
    const secretNames = Object.values(args.secretRefs);
    const serviceSecretsSection = secretNames.length
      ? `    secrets:\n${secretNames.map((n) => `      - ${n}`).join('\n')}\n`
      : '';
    const rootSecretsSection = secretNames.length
      ? `secrets:\n${secretNames.map((n) => `  ${n}:\n    external: true`).join('\n')}\n`
      : '';

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

    const storageHeader = [
      ...args.envKeys.map((k) => `# app.store.${k}: env`),
      ...Object.keys(args.secretRefs).map((k) => `# app.store.${k}: secret`),
      ...Object.entries(args.secretRefs).map(([k, n]) => `# secret.${k}: ${n}`),
    ].join('\n');
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
    const traefikLabelsSection = this.buildTraefikLabelSection(args.traefik);
    return `# weehawk application service
# sourceDir: ${args.sourceDir}
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
${traefikLabelsSection}${envSection}${serviceSecretsSection}${svcNetworkSection}${rootSecretsSection}${rootNetworkSection}`;
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
  ) {
    const service = await this.findOne(id);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException(
        'This service is not an application-type service.',
      );
    }
    const { external: ext, stack: stk } = this.normalizeApplicationNetworkPayload(dto);

    service.dockerConfig = await this.composeApplicationDockerConfigForService(service, {
      external: ext,
      stack: stk,
    });
    return await this.serviceRepository.save(service);
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
    const storageMap = this.resolveApplicationStorageMap(parsedVars);
    const valuesMap = this.resolveApplicationValuesMap(parsedVars);
    const envValues = this.pickCredentialsByStorage(valuesMap, storageMap, 'env');
    const secretValues = this.pickCredentialsByStorage(valuesMap, storageMap, 'secret');

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
    const secretRefs = this.mergeApplicationSecretRefs(
      service.appName,
      secretValues,
      storageMap,
      previousConfig,
    );
    await this.removeObsoleteManagedSecrets(previousConfig, secretRefs);
    await this.ensureSecretsExist(secretRefs, secretValues);
    const managedKeys = this.parseManagedApplicationKeysFromHeader(previousConfig);
    const envWithoutManaged = this.removeEnvKeys(service.env || '', managedKeys);
    service.env = this.mergeCredentialsIntoEnv(envWithoutManaged, envValues);

    const network = this.resolveUploadNetworks(options, previousConfig);
    const networkMerged = this.ensureTraefikExternalNetwork(network, service);
    const traefik = await this.buildTraefikIngressForCompose(service, containerPort);

    service.dockerConfig = this.composeApplicationDockerConfig({
      sourceDir: 'app-source',
      buildPath,
      dockerfilePath,
      buildMode,
      deployMode: 'source',
      imageRef: undefined,
      dockerfileGenerated,
      imageName: `${service.appName}:latest`,
      containerPort,
      publishPort,
      replicas,
      envKeys: Object.keys(envValues),
      secretRefs,
      network: networkMerged,
      traefik,
    });
    return await this.serviceRepository.save(service);
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
    const service = await this.findOne(id);
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
    return {
      success: true,
      message: 'Archive uploaded and application stack generated.',
      service: saved,
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
  ) {
    const service = await this.findOne(id);
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
    return {
      success: true,
      message: 'Repository cloned and application stack generated.',
      service: saved,
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
  ) {
    const service = await this.findOne(id);
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

    const fresh = await this.findOne(id);
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
  ) {
    const service = await this.findOne(id);
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
    return {
      success: true,
      message: 'Application stack generated from source.',
      service: saved,
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
  ) {
    const service = await this.findOne(id);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException('This service is not an application-type service.');
    }
    const imageRef = this.validateDockerImageRef(options.imageRef);
    let containerPort = options.containerPort ?? 3000;
    const publishPort = options.publishPort;
    const replicas = Math.min(10, Math.max(1, Math.floor(options.replicas ?? 1)));
    const parsedVars = this.parseApplicationVariables(options?.variablesJson);
    const storageMap = this.resolveApplicationStorageMap(parsedVars);
    const valuesMap = this.resolveApplicationValuesMap(parsedVars);
    const envValues = this.pickCredentialsByStorage(valuesMap, storageMap, 'env');
    const secretValues = this.pickCredentialsByStorage(valuesMap, storageMap, 'secret');

    const previousConfig = service.dockerConfig || '';
    const secretRefs = this.mergeApplicationSecretRefs(
      service.appName,
      secretValues,
      storageMap,
      previousConfig,
    );
    await this.removeObsoleteManagedSecrets(previousConfig, secretRefs);
    await this.ensureSecretsExist(secretRefs, secretValues);
    const managedKeys = this.parseManagedApplicationKeysFromHeader(previousConfig);
    const envWithoutManaged = this.removeEnvKeys(service.env || '', managedKeys);
    service.env = this.mergeCredentialsIntoEnv(envWithoutManaged, envValues);

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
      envKeys: Object.keys(envValues),
      secretRefs,
      network: networkMerged,
      traefik,
    });
    const saved = await this.serviceRepository.save(service);
    return {
      success: true,
      message: 'Application stack configured for image deploy.',
      service: saved,
    };
  }

  private parseApplicationVariables(raw?: string): Array<{ key: string; value: string; store: 'env' | 'secret' }> {
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
    const out: Array<{ key: string; value: string; store: 'env' | 'secret' }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const key = String(row.key ?? '').trim();
      const value = String(row.value ?? '');
      const storeRaw = String(row.store ?? 'secret').trim().toLowerCase();
      const store = storeRaw === 'secret' ? 'secret' : 'env';
      if (!key) continue;
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        throw new BadRequestException(`Invalid variable key: ${key}`);
      }
      out.push({ key, value, store });
    }
    return out;
  }

  private resolveApplicationStorageMap(
    vars: Array<{ key: string; value: string; store: 'env' | 'secret' }>,
  ): Record<string, 'env' | 'secret'> {
    const out: Record<string, 'env' | 'secret'> = {};
    for (const v of vars) out[v.key] = v.store;
    return out;
  }

  private resolveApplicationValuesMap(
    vars: Array<{ key: string; value: string; store: 'env' | 'secret' }>,
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
   */
  getServiceLogsStream(id: number): Observable<{ data: string }> {
    return new Observable((observer) => {
      let child: ChildProcess | null = null;
      let cancelled = false;
      let stderrBuf = '';

      void this.findOne(id)
        .then(async (service) => {
          if (cancelled) return;

          const deployDir = getServiceDeploymentDir(
            service.appName,
            this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
          );
          const composeFile = path.join(deployDir, 'docker-compose.yml');
          const key = this.firstComposeServiceName(service.dockerConfig || '');

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
        })
        .catch((err) => observer.error(err));

      return () => {
        cancelled = true;
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
      };
    });
  }

  async executeDeployment(
    id: number,
    mode: 'deploy' | 'reload' | 'redeploy' = 'deploy',
    options?: { deployLogEmitter?: EventEmitter },
  ) {
    await this.findOne(id);
    const result = await this.executorService.execute(id, mode, options);
    if (result.success) {
      await this.serviceRepository.update(id, { lastDeployedAt: new Date() });
    }
    return result;
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
    await this.findOne(serviceId);
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
    void userId;
    await this.findOne(serviceId);
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
  ): Promise<{ ok: boolean; output: string }> {
    await this.findOne(serviceId);
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
      await this.s3Service.downloadObjectToFile(profile, key, tmpPath);
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

  async startService(id: number) {
    await this.findOne(id);
    return await this.executorService.startContainers(id);
  }

  async getRuntimeStatus(id: number) {
    await this.findOne(id);
    return await this.executorService.getRuntimeStatus(id);
  }

  async getServiceVolumes(id: number) {
    await this.findOne(id);
    return await this.executorService.getServiceVolumeMounts(id);
  }

  async findAll() {
    return await this.serviceRepository.find({ 
      relations: ['project'], 
      order: { createdAt: 'DESC' } 
    });
  }

  async findByProjectId(projectId: number) {
    return await this.serviceRepository.find({
      where: { project: { id: projectId } },
      relations: ['project'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByProjectIdPaginated(
    projectId: number,
    page: number,
    limit: number,
    q?: string,
  ) {
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

    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async findOne(id: number) {
    const service = await this.serviceRepository.findOne({ 
      where: { id }, 
      relations: ['project', 'remoteServer'] 
    });
    if (!service) throw new NotFoundException(`Service #${id} not found`);
    return service;
  }

  async remove(id: number) {
    const service = await this.findOne(id);
    await this.executorService.stopAndRemove(id);
    await this.removeManagedSecretsForService(service.dockerConfig || '');
    await this.serviceRepository.remove(service);
    return { success: true };
  }

  async update(id: number, updateServiceDto: UpdateServiceDto) {
    const service = await this.findOne(id);
    if (updateServiceDto.remoteServerId !== undefined) {
      if (updateServiceDto.remoteServerId !== null) {
        const rs = await this.remoteServerRepository.findOneBy({
          id: updateServiceDto.remoteServerId,
        });
        if (!rs) {
          throw new BadRequestException('Remote server not found');
        }
      }
    }
    const updated = this.serviceRepository.merge(service, updateServiceDto);
    const shouldRefreshAppCompose =
      updated.composeType === composeType.APPLICATION &&
      (updateServiceDto.domains !== undefined ||
        updateServiceDto.traefikRoutes !== undefined) &&
      (updated.dockerConfig || '').trim().length > 0;
    if (shouldRefreshAppCompose) {
      updated.dockerConfig = await this.composeApplicationDockerConfigForService(updated);
    }
    return await this.serviceRepository.save(updated);
  }


  async shutdownService(id: number) {
    await this.findOne(id);
    return await this.executorService.shutdown(id);
  }

  /**
   * Generate database stack YAML from form fields → `dockerConfig`.
   * Credentials are stored in Docker secrets and referenced from YAML.
   */
  async applyDatabase(
    id: number,
    engine: DatabaseEngine,
    dto: DatabaseSetupDto,
  ) {
    const service = await this.findOne(id);
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
    // Allow re-applying database settings for the same engine so users can
    // switch per-variable storage (env vs secret) after initial setup.
    const normalized = this.normalizeDatabaseSetupInput(engine, dto);
    const safeDb = this.databaseGenerator.sanitizeDbName(normalized.dbName);
    const allCredentials = this.credentialsForEngine(engine, safeDb, normalized);
    const storageMap = this.resolveStorageMapForEngine(engine, dto);
    const plainEnv = this.pickCredentialsByStorage(
      allCredentials,
      storageMap,
      'env',
    );
    const secretEnv = this.pickCredentialsByStorage(
      allCredentials,
      storageMap,
      'secret',
    );
    const secretRefs = this.buildSecretRefs(service.appName, secretEnv);
    await this.ensureSecretsExist(secretRefs, secretEnv);
    try {
      service.dockerConfig = this.databaseGenerator.buildDatabaseDockerConfig(
        engine,
        normalized.dbName,
        dto.replicas ?? 1,
        dto.publishPort,
        dto.image,
        normalized.volumePath,
        Object.keys(plainEnv),
        storageMap,
        secretRefs,
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
    return await this.serviceRepository.save(service);
  }

  async applyPostgresDatabase(id: number, dto: DatabaseSetupDto) {
    return this.applyDatabase(id, 'postgres', dto);
  }

  /**
   * Regenerate stack YAML with optional new host port and/or replicas.
   * Does not change credentials in env.
   */
  async updateDatabaseStack(
    id: number,
    engine: DatabaseEngine,
    dto: PostgresStackUpdateDto,
  ) {
    if (dto.publishPort === undefined && dto.replicas === undefined) {
      return this.findOne(id);
    }
    const service = await this.findOne(id);
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
    const storageMap = this.resolveStorageMapFromHeader(raw, engine);
    const currentSecretRefs = this.parseSecretRefsFromHeader(raw);
    if (
      currentImage &&
      !DatabaseGeneratorService.IMAGE_REF_PATTERN.test(currentImage)
    ) {
      currentImage = this.defaultImageForEngine(engine);
    }
    service.dockerConfig = this.databaseGenerator.buildDatabaseDockerConfig(
      engine,
      dbName,
      replicas,
      port,
      currentImage,
      currentVolumePath,
      Object.keys(this.pickCredentialsByStorage(
        this.credentialsForEngine(engine, dbName, {
          user: '',
          pass: '',
          rootUser: '',
          rootPass: '',
          password: '',
        }),
        this.resolveStorageMapFromHeader(raw, engine),
        'env',
      )),
      storageMap,
      currentSecretRefs,
    );
    return await this.serviceRepository.save(service);
  }

  async updatePostgresStack(id: number, dto: PostgresStackUpdateDto) {
    return this.updateDatabaseStack(id, 'postgres', dto);
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

  private pickCredentialsByStorage(
    credentials: Record<string, string>,
    storage: Record<string, 'env' | 'secret'>,
    target: 'env' | 'secret',
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(credentials)) {
      if (!v) continue;
      if ((storage[k] ?? this.defaultStorageForKey(k)) === target) {
        out[k] = v;
      }
    }
    return out;
  }

  private defaultStorageForKey(key: string): 'env' | 'secret' {
    return key.includes('PASSWORD') ? 'secret' : 'env';
  }

  private resolveStorageMapForEngine(
    engine: DatabaseEngine,
    dto: DatabaseSetupDto,
  ): Record<string, 'env' | 'secret'> {
    const pick = (v?: string): 'env' | 'secret' | undefined =>
      v === 'env' || v === 'secret' ? v : undefined;
    if (engine === 'postgres') {
      return {
        POSTGRES_DB: pick(dto.storeDbName) ?? 'env',
        POSTGRES_USER: pick(dto.storeUser) ?? 'env',
        POSTGRES_PASSWORD: pick(dto.storePass) ?? 'secret',
      };
    }
    if (engine === 'mysql') {
      return {
        MYSQL_DATABASE: pick(dto.storeDbName) ?? 'env',
        MYSQL_USER: pick(dto.storeUser) ?? 'env',
        MYSQL_PASSWORD: pick(dto.storePass) ?? 'secret',
        MYSQL_ROOT_PASSWORD: pick(dto.storeRootPass) ?? 'secret',
      };
    }
    if (engine === 'mariadb') {
      return {
        MARIADB_DATABASE: pick(dto.storeDbName) ?? 'env',
        MARIADB_USER: pick(dto.storeUser) ?? 'env',
        MARIADB_PASSWORD: pick(dto.storePass) ?? 'secret',
        MARIADB_ROOT_PASSWORD: pick(dto.storeRootPass) ?? 'secret',
      };
    }
    if (engine === 'mongodb') {
      return {
        MONGO_INITDB_DATABASE: pick(dto.storeDbName) ?? 'env',
        MONGO_INITDB_ROOT_USERNAME: pick(dto.storeRootUser) ?? 'env',
        MONGO_INITDB_ROOT_PASSWORD: pick(dto.storeRootPass) ?? 'secret',
      };
    }
    return { REDIS_PASSWORD: pick(dto.storePassword) ?? 'secret' };
  }

  private defaultStorageMapForEngine(
    engine: DatabaseEngine,
  ): Record<string, 'env' | 'secret'> {
    if (engine === 'postgres') {
      return {
        POSTGRES_DB: 'env',
        POSTGRES_USER: 'env',
        POSTGRES_PASSWORD: 'secret',
      };
    }
    if (engine === 'mysql') {
      return {
        MYSQL_DATABASE: 'env',
        MYSQL_USER: 'env',
        MYSQL_PASSWORD: 'secret',
        MYSQL_ROOT_PASSWORD: 'secret',
      };
    }
    if (engine === 'mariadb') {
      return {
        MARIADB_DATABASE: 'env',
        MARIADB_USER: 'env',
        MARIADB_PASSWORD: 'secret',
        MARIADB_ROOT_PASSWORD: 'secret',
      };
    }
    if (engine === 'mongodb') {
      return {
        MONGO_INITDB_DATABASE: 'env',
        MONGO_INITDB_ROOT_USERNAME: 'env',
        MONGO_INITDB_ROOT_PASSWORD: 'secret',
      };
    }
    return { REDIS_PASSWORD: 'secret' };
  }

  private resolveStorageMapFromHeader(
    raw: string,
    engine: DatabaseEngine,
  ): Record<string, 'env' | 'secret'> {
    const out = this.defaultStorageMapForEngine(engine);
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*#\s*store\.([A-Z0-9_]+):\s*(env|secret)\s*$/);
      if (!m) continue;
      out[m[1]] = m[2] as 'env' | 'secret';
    }
    return out;
  }

  private sanitizeSecretToken(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private buildSecretRefs(
    appName: string | undefined,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const app = this.sanitizeSecretToken(appName || 'db');
    const refs: Record<string, string> = {};
    for (const key of Object.keys(credentials)) {
      refs[key] = `${app}_${this.sanitizeSecretToken(key)}`;
    }
    return refs;
  }

  /**
   * Declared secret keys (from variablesJson) must stay in YAML headers even when
   * the client sends an empty value (e.g. unreadable/redacted secrets after generate).
   * Otherwise `pickCredentialsByStorage` drops them and the UI loses those rows.
   * Reuse previous `# secret.KEY: name` when present so Docker secrets are not
   * orphaned by name churn.
   */
  private mergeApplicationSecretRefs(
    appName: string | undefined,
    secretValues: Record<string, string>,
    storageMap: Record<string, 'env' | 'secret'>,
    previousConfig: string,
  ): Record<string, string> {
    const prevByKey = this.parseApplicationSecretRefsFromDockerConfig(previousConfig || '');
    const built = this.buildSecretRefs(appName, secretValues);
    const app = this.sanitizeSecretToken(appName || 'app');
    const out: Record<string, string> = {};
    for (const [key, store] of Object.entries(storageMap)) {
      if (store !== 'secret') continue;
      if (built[key]) {
        out[key] = built[key];
      } else {
        out[key] = prevByKey[key] ?? `${app}_${this.sanitizeSecretToken(key)}`;
      }
    }
    return out;
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

  private async ensureSecretsExist(
    refs: Record<string, string>,
    credentials: Record<string, string>,
  ): Promise<void> {
    for (const [envKey, secretName] of Object.entries(refs)) {
      const value = credentials[envKey];
      if (!value) continue;
      try {
        await this.dockerSecrets.findOne(secretName);
      } catch (e) {
        await this.dockerSecrets.create(secretName, value);
      }
    }
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
}

export {
  writeWeehawkGeneratedDockerfile,
  resolveEffectiveDockerfileRel,
  WEEHAWK_GENERATED_DOCKERFILE_REL,
} from './weehawk-build-paths';