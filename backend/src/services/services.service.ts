import {
  Injectable,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
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
import { DatabaseGeneratorService } from './database-generator.service';
import { PostgresDatabaseDto } from './dto/postgres-database.dto';
import { PostgresStackUpdateDto } from './dto/postgres-stack-update.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @Inject(forwardRef(() => ExecutorService))
    private readonly executorService: ExecutorService,
    private readonly databaseGenerator: DatabaseGeneratorService,
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

          const deployDir = path.join(process.cwd(), 'deployments', service.appName);
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
    await this.executorService.stopAndRemove(id);
    const service = await this.findOne(id);
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
   * Generate Postgres stack YAML from form fields → `dockerConfig`.
   * User/password/db name are stored in `env` (POSTGRES_*) so they are not embedded in YAML;
   * deploy passes them to `docker stack deploy` for Compose variable substitution.
   */
  async applyPostgresDatabase(id: number, dto: PostgresDatabaseDto) {
    const service = await this.findOne(id);
    if (service.composeType !== composeType.DATABASES) {
      throw new BadRequestException(
        'This service is not a database-type service.',
      );
    }
    const raw = (service.dockerConfig || '').trim();
    const engineMatch = raw.match(/^\s*#\s*engine:\s*(\w+)/m);
    if (engineMatch && engineMatch[1] !== 'postgres') {
      throw new BadRequestException(
        'This service is not configured for Postgres (engine mismatch).',
      );
    }
    const hasStackYaml = raw.includes('services:');
    const hasStoredCredentials = /POSTGRES_PASSWORD=/.test(service.env || '');
    if (hasStackYaml && hasStoredCredentials) {
      throw new BadRequestException(
        'Postgres is already configured. Credentials cannot be changed via this endpoint.',
      );
    }
    const safeDb = this.databaseGenerator.sanitizeDbName(dto.dbName);
    try {
      service.dockerConfig = this.databaseGenerator.buildPostgresDockerConfig(
        dto.dbName,
        dto.replicas ?? 1,
        dto.publishPort,
        dto.image,
      );
    } catch (e) {
      if (e instanceof Error && e.message === 'Invalid Postgres image reference') {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
    service.env = this.mergePostgresCredentialsIntoEnv(service.env || '', {
      POSTGRES_DB: safeDb,
      POSTGRES_USER: dto.user,
      POSTGRES_PASSWORD: dto.pass,
    });
    return await this.serviceRepository.save(service);
  }

  /**
   * Regenerate stack YAML with optional new host port and/or replicas. Does not change credentials in env.
   */
  async updatePostgresStack(id: number, dto: PostgresStackUpdateDto) {
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
    if (!/#\s*engine:\s*postgres/.test(raw)) {
      throw new BadRequestException(
        'This service is not configured for Postgres.',
      );
    }
    if (!raw.includes('services:')) {
      throw new BadRequestException(
        'No stack file yet. Configure Postgres first.',
      );
    }
    const envMap = this.parseEnvLines(service.env || '');
    let dbName: string | undefined = envMap['POSTGRES_DB'];
    if (!dbName) {
      const m = raw.match(/^\s*services:\s*\r?\n\s*(\w+)\s*:/m);
      if (m?.[1]) dbName = m[1];
    }
    if (!dbName) {
      throw new BadRequestException(
        'Could not resolve database name (POSTGRES_DB or stack service key).',
      );
    }
    const currentReplicas = this.parseYamlReplicasFromConfig(raw);
    const currentPort = this.parsePublishPortFromYaml(raw);
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
      DatabaseGeneratorService.parsePostgresImageFromYaml(raw) ??
      DatabaseGeneratorService.POSTGRES_DOCKER_IMAGE;
    if (
      currentImage &&
      !DatabaseGeneratorService.POSTGRES_IMAGE_REF_PATTERN.test(currentImage)
    ) {
      currentImage = DatabaseGeneratorService.POSTGRES_DOCKER_IMAGE;
    }
    service.dockerConfig = this.databaseGenerator.buildPostgresDockerConfig(
      dbName,
      replicas,
      port,
      currentImage,
    );
    return await this.serviceRepository.save(service);
  }

  private parsePublishPortFromYaml(config: string): number | null {
    const m = config.match(/ports:\s*\n\s*-\s*"(\d+):5432"/);
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

  /** Upserts POSTGRES_* lines in the service env block; preserves other keys and comments. */
  private mergePostgresCredentialsIntoEnv(
    existing: string,
    credentials: Record<'POSTGRES_DB' | 'POSTGRES_USER' | 'POSTGRES_PASSWORD', string>,
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
}