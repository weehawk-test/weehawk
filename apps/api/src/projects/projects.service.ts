import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
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
    return await this.projectRepository.remove(project);
  }
}
