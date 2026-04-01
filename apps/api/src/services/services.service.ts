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
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { Project } from 'src/projects/entities/project.entity';
import { randomBytes } from 'crypto';
import { ExecutorService } from './ExecutorService';
import { spawn, type ChildProcess } from 'child_process';
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
import { getServiceDeploymentDir } from './deployment-paths';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @Inject(forwardRef(() => ExecutorService))
    private readonly executorService: ExecutorService,
    private readonly configService: ConfigService,
    private readonly databaseGenerator: DatabaseGeneratorService,
    private readonly dockerSecrets: DockerSecretsService,
  ) {}

  async create(createServiceDto: CreateServiceDto) {
    const { projectId, appName, ...serviceData } = createServiceDto;
    const project = await this.projectRepository.findOneBy({ id: projectId });
    if (!project) throw new NotFoundException('Project not found');

    const uniqueAppName = `${appName}-${randomBytes(2).toString('hex')}`;
    const service = this.serviceRepository.create({
      ...serviceData,
      appName: uniqueAppName,
      project: project,
    });

    return await this.serviceRepository.save(service);
  }

  private normalizeArchivePath(raw: string, fallback: string): string {
    const t = (raw || fallback).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return t || fallback;
  }

  private composeApplicationDockerConfig(args: {
    sourceDir: string;
    buildPath: string;
    dockerfilePath: string;
    buildMode: 'dockerfile' | 'nixpacks';
    imageName: string;
    containerPort: number;
    publishPort?: number;
    replicas: number;
    envKeys: string[];
    secretRefs: Record<string, string>;
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
    const storageHeader = [
      ...args.envKeys.map((k) => `# app.store.${k}: env`),
      ...Object.keys(args.secretRefs).map((k) => `# app.store.${k}: secret`),
      ...Object.entries(args.secretRefs).map(([k, n]) => `# secret.${k}: ${n}`),
    ].join('\n');
    return `# weehawk application service
# sourceDir: ${args.sourceDir}
# buildPath: ${args.buildPath}
# dockerfilePath: ${args.dockerfilePath}
# buildMode: ${args.buildMode}
${storageHeader ? `${storageHeader}\n` : ''}version: '3.8'

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
${envSection}${serviceSecretsSection}${rootSecretsSection}`;
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

  async uploadApplicationArchive(
    id: number,
    file: Express.Multer.File,
    options?: {
      buildPath?: string;
      dockerfilePath?: string;
      buildMode?: 'dockerfile' | 'nixpacks';
      containerPort?: number;
      publishPort?: number;
      replicas?: number;
      variablesJson?: string;
    },
  ) {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('ZIP file is required.');
    }
    const service = await this.findOne(id);
    if (service.composeType !== composeType.APPLICATION) {
      throw new BadRequestException('This service is not an application-type service.');
    }
    const buildPath = this.normalizeArchivePath(options?.buildPath || '.', '.');
    let dockerfilePath = this.normalizeArchivePath(options?.dockerfilePath || '', '');
    const buildMode: 'dockerfile' | 'nixpacks' =
      options?.buildMode === 'nixpacks' ? 'nixpacks' : 'dockerfile';
    const containerPort = options?.containerPort ?? 3000;
    const publishPort = options?.publishPort;
    const replicas = Math.min(10, Math.max(1, Math.floor(options?.replicas ?? 1)));
    const parsedVars = this.parseApplicationVariables(options?.variablesJson);
    const storageMap = this.resolveApplicationStorageMap(parsedVars);
    const valuesMap = this.resolveApplicationValuesMap(parsedVars);
    const envValues = this.pickCredentialsByStorage(valuesMap, storageMap, 'env');
    const secretValues = this.pickCredentialsByStorage(valuesMap, storageMap, 'secret');

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
      if (buildMode === 'nixpacks') {
        const contextDir = path.join(sourceDir, buildPath);
        try {
          await fs.access(contextDir);
        } catch {
          throw new BadRequestException(
            `Build path not found in archive: "${buildPath}".`,
          );
        }
        dockerfilePath = 'nixpacks';
      } else {
        dockerfilePath = await this.resolveDockerfilePath(
          sourceDir,
          buildPath,
          dockerfilePath || undefined,
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('Could not read archive build context.');
    } finally {
      await fs.rm(zipPath, { force: true });
    }

    await this.removeManagedSecretsForService(service.dockerConfig || '');
    const secretRefs = this.buildSecretRefs(service.appName, secretValues);
    await this.ensureSecretsExist(secretRefs, secretValues);
    const managedKeys = this.parseManagedApplicationKeysFromHeader(service.dockerConfig || '');
    const envWithoutManaged = this.removeEnvKeys(service.env || '', managedKeys);
    service.env = this.mergeCredentialsIntoEnv(envWithoutManaged, envValues);

    service.dockerConfig = this.composeApplicationDockerConfig({
      sourceDir: 'app-source',
      buildPath,
      dockerfilePath,
      buildMode,
      imageName: `${service.appName}:latest`,
      containerPort,
      publishPort,
      replicas,
      envKeys: Object.keys(envValues),
      secretRefs,
    });
    const saved = await this.serviceRepository.save(service);
    return {
      success: true,
      message: 'Archive uploaded and application stack generated.',
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

  async executeDeployment(id: number, mode: 'deploy' | 'reload' | 'redeploy' = 'deploy') {
    await this.findOne(id);
    const result = await this.executorService.execute(id, mode);
    if (result.success) {
      await this.serviceRepository.update(id, { lastDeployedAt: new Date() });
    }
    return result;
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

  async findOne(id: number) {
    const service = await this.serviceRepository.findOne({ 
      where: { id }, 
      relations: ['project'] 
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
    const updated = this.serviceRepository.merge(service, updateServiceDto);
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

  private parseSecretRefsFromHeader(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*#\s*secret\.([A-Z0-9_]+):\s*(.+)\s*$/);
      if (!m) continue;
      out[m[1]] = m[2].trim();
    }
    return out;
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

  private async removeManagedSecretsForService(rawConfig: string): Promise<void> {
    const refs = this.parseSecretRefsFromHeader(rawConfig || '');
    for (const secretName of Object.values(refs)) {
      if (!secretName) continue;
      try {
        await this.dockerSecrets.remove(secretName);
      } catch {
        // Best-effort cleanup: secret may already be missing or still in use.
      }
    }
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