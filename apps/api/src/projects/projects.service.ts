import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { DockerSecretsService } from 'src/dockersecrets/dockersecrets.service';
import { composeType } from 'src/services/entities/composeType.enum';
import { Service } from 'src/services/entities/service.entity';
import { getServiceDeploymentDir } from 'src/services/deployment-paths';

const execAsync = promisify(exec);

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    private readonly configService: ConfigService,
    private readonly dockerSecrets: DockerSecretsService,
  ) {}

  async create(createProjectDto: CreateProjectDto, userId: number) {
    const existing = await this.projectRepository.findOneBy({
      name: createProjectDto.name,
      userId,
    });
    if (existing) {
      throw new ConflictException('Project name already exists');
    }

    const project = this.projectRepository.create({
      ...createProjectDto,
      userId,
    });
    return await this.projectRepository.save(project);
  }

  async findAllPaginated(
    page: number,
    limit: number,
    q: string | undefined,
    userId: number,
  ) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 9));
    const trimmed = (q ?? '').trim().toLowerCase();

    const countQb = this.projectRepository
      .createQueryBuilder('project')
      .where('project.userId = :userId', { userId });
    if (trimmed) {
      countQb.andWhere(
        '(LOWER(project.name) LIKE :q OR LOWER(COALESCE(project.description, \'\')) LIKE :q)',
        { q: `%${trimmed}%` },
      );
    }
    const total = await countQb.getCount();

    const dataQb = this.projectRepository
      .createQueryBuilder('project')
      .where('project.userId = :userId', { userId })
      .loadRelationCountAndMap('project.serviceCount', 'project.services');

    if (trimmed) {
      dataQb.andWhere(
        '(LOWER(project.name) LIKE :q OR LOWER(COALESCE(project.description, \'\')) LIKE :q)',
        { q: `%${trimmed}%` },
      );
    }

    const data = await dataQb
      .orderBy('project.createdAt', 'DESC')
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

  async findOne(id: number, userId: number) {
    const project = await this.projectRepository.findOne({
      where: { id, userId },
      relations: ['services'],
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }
    return project;
  }

  async update(id: number, updateProjectDto: UpdateProjectDto, userId: number) {
    const project = await this.findOne(id, userId);
    const updated = this.projectRepository.merge(project, updateProjectDto);
    return await this.projectRepository.save(updated);
  }

  async remove(id: number, userId: number) {
    const project = await this.findOne(id, userId);
    const services = project.services ?? [];
    if (services.length > 0) {
      throw new ConflictException(
        `Cannot delete project while it still contains services (${services.length}). Delete all services in this project first, then try again.`,
      );
    }
    const runningServices = await this.findRunningServices(services);
    if (runningServices.length > 0) {
      throw new ConflictException(
        `Cannot delete project while services are still running: ${runningServices.join(
          ', ',
        )}. Please stop and delete these services manually, then try deleting the project again.`,
      );
    }
    await this.removeManagedSecretsForProject(project);
    return await this.projectRepository.remove(project);
  }

  private async findRunningServices(services: Service[]): Promise<string[]> {
    const running: string[] = [];
    for (const svc of services) {
      try {
        const isRunning = await this.isServiceRuntimeRunning(svc);
        if (isRunning) running.push(svc.name || svc.appName || `#${svc.id}`);
      } catch {
        // If runtime check fails, don't block deletion by itself.
      }
    }
    return running;
  }

  private async isServiceRuntimeRunning(service: Service): Promise<boolean> {
    const isStackService =
      service.composeType === composeType.STACK ||
      service.composeType === composeType.DATABASES;
    if (isStackService) {
      const { stdout } = await execAsync(
        `docker stack services ${service.appName} --format "{{.Replicas}}"`,
      );
      return stdout.split(/\r?\n/).some((line) => {
        const m = line.trim().match(/^(\d+)\//);
        return m !== null && parseInt(m[1], 10) > 0;
      });
    }

    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    const exists = await fs
      .access(composeFile)
      .then(() => true)
      .catch(() => false);
    if (!exists) return false;

    const { stdout } = await execAsync(
      `docker compose -f "${composeFile}" -p ${service.appName} ps --status running -q`,
      { cwd: deployDir },
    );
    return stdout.trim().length > 0;
  }

  private parseSecretRefsFromConfig(config: string): string[] {
    const out: string[] = [];
    for (const line of (config || '').split(/\r?\n/)) {
      const m = line.match(/^\s*#\s*secret\.[A-Z0-9_]+:\s*(.+)\s*$/);
      if (!m?.[1]) continue;
      out.push(m[1].trim());
    }
    return out;
  }

  private async removeManagedSecretsForProject(project: Project): Promise<void> {
    const all = new Set<string>();
    for (const svc of project.services ?? []) {
      for (const name of this.parseSecretRefsFromConfig(svc.dockerConfig || '')) {
        if (name) all.add(name);
      }
    }
    for (const name of all) {
      try {
        await this.dockerSecrets.remove(name);
      } catch {
        // best-effort cleanup (secret may be missing or in use)
      }
    }
  }
}
