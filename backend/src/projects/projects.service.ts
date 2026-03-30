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

  async create(createProjectDto: CreateProjectDto) {
    const existing = await this.projectRepository.findOneBy({
      name: createProjectDto.name,
    });
    if (existing) {
      throw new ConflictException('Project name already exists');
    }

    const project = this.projectRepository.create(createProjectDto);
    return await this.projectRepository.save(project);
  }

  async findAll() {
    return await this.projectRepository.find({
      relations: ['services'],
    });
  }

  async findOne(id: number) {
    const project = await this.projectRepository.findOne({
      where: { id },
      relations: ['services'],
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async update(id: number, updateProjectDto: UpdateProjectDto) {
    const project = await this.findOne(id);
    const updated = this.projectRepository.merge(project, updateProjectDto);
    return await this.projectRepository.save(updated);
  }

  async remove(id: number) {
    const project = await this.findOne(id);
    return await this.projectRepository.remove(project);
  }
}
