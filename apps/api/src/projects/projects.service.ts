import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { generatePublicId, isLikelyNumericId } from '../common/public-id';
import { UserIdTenantScopedRepository } from '../common/tenant-scoped.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';
import { parseOrganizationPublicIdParam } from '../organizations/org-public-id';

@Injectable()
export class ProjectsService {
  private readonly scopedProjects: UserIdTenantScopedRepository<Project>;

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    private readonly organizationsService: OrganizationsService,
  ) {
    this.scopedProjects = new UserIdTenantScopedRepository<Project>(
      this.projectRepository,
      'Project',
    );
  }

  private logProjectAudit(
    organizationId: number,
    userId: number,
    action: string,
    endpoint: string,
    project: Pick<Project, 'name' | 'publicId'>,
    extra?: Record<string, unknown>,
  ): void {
    void this.organizationsService
      .appendOrganizationAuditEvent(organizationId, userId, action, {
        metadata: {
          endpoint,
          projectPublicId: project.publicId?.trim() || null,
          projectName: project.name,
          ...(extra ?? {}),
        },
      })
      .catch(() => undefined);
  }

  private async _internal_system_saveProject(project: Project): Promise<Project> {
    return this.projectRepository.save(project);
  }

  private async _internal_system_removeProject(project: Project): Promise<Project> {
    return this.projectRepository.remove(project);
  }

  private async ensureProjectPublicId(project: Project): Promise<Project> {
    if (project.publicId) return project;
    project.publicId = generatePublicId('prj');
    return this._internal_system_saveProject(project);
  }

  private async ensureProjectPublicIds(rows: Project[]): Promise<Project[]> {
    return Promise.all(rows.map((row) => this.ensureProjectPublicId(row)));
  }

  async create(createProjectDto: CreateProjectDto, userId: number) {
    const orgRaw = parseOrganizationPublicIdParam(
      createProjectDto.organizationPublicId,
    );
    const ctx = await this.organizationsService.requireMemberContext(
      orgRaw,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS,
      },
    );
    const organizationId = ctx.internalId;
    await this.organizationsService.assertMemberCanAddOrgProject(
      userId,
      organizationId,
    );

    const nameTrim = createProjectDto.name.trim();
    const existingDup = await this.projectRepository.findOne({
      where: { organizationId, name: nameTrim },
    });
    if (existingDup) {
      throw new ConflictException('Project name already exists');
    }

    const project = this.projectRepository.create({
      name: nameTrim,
      description: createProjectDto.description,
      userId,
      publicId: generatePublicId('prj'),
      organizationId,
    });
    const saved = await this.scopedProjects.saveScoped(project, userId);
    this.logProjectAudit(
      organizationId,
      userId,
      'security.project.created',
      'POST /api/projects',
      saved,
    );
    return saved;
  }

  async findAllPaginatedForOrganization(
    organizationInternalId: number,
    page: number,
    limit: number,
    q: string | undefined,
  ) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 9));
    const trimmed = (q ?? '').trim().toLowerCase();

    const countQb = this.projectRepository
      .createQueryBuilder('project')
      .where('project.organizationId = :organizationId', {
        organizationId: organizationInternalId,
      });
    if (trimmed) {
      countQb.andWhere(
        "(LOWER(project.name) LIKE :q OR LOWER(COALESCE(project.description, '')) LIKE :q)",
        { q: `%${trimmed}%` },
      );
    }
    const total = await countQb.getCount();

    const dataQb = this.projectRepository
      .createQueryBuilder('project')
      .where('project.organizationId = :organizationId', {
        organizationId: organizationInternalId,
      })
      .loadRelationCountAndMap('project.serviceCount', 'project.services');

    if (trimmed) {
      dataQb.andWhere(
        "(LOWER(project.name) LIKE :q OR LOWER(COALESCE(project.description, '')) LIKE :q)",
        { q: `%${trimmed}%` },
      );
    }

    const data = await dataQb
      .orderBy('project.createdAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getMany();

    return {
      data: await this.ensureProjectPublicIds(data),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  /** Resolves a numeric DB id for users who are members of the project's organization. */
  async findByInternalIdForUser(
    projectId: number,
    userId: number,
  ): Promise<Project> {
    if (!Number.isFinite(projectId) || projectId < 1) {
      throw new BadRequestException('Invalid project id');
    }
    const id = Math.trunc(projectId);
    const project = await this.projectRepository
      .createQueryBuilder('project')
      .where('project.id = :id', { id })
      .andWhere(
        'project.organizationId IN (SELECT m.organization_id FROM organization_memberships m WHERE m.user_id = :uid)',
        { uid: userId },
      )
      .getOne();
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return this.ensureProjectPublicId(project);
  }

  async resolveProjectByIdentifier(
    identifier: string,
    userId: number,
  ): Promise<Project> {
    const trimmed = String(identifier).trim();
    if (!trimmed)
      throw new BadRequestException('Project identifier is required');
    if (isLikelyNumericId(trimmed)) {
      throw new BadRequestException(
        'Numeric project id is not allowed. Use publicId.',
      );
    }
    const project = await this.projectRepository
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.services', 'services')
      .where('project.publicId = :pid', { pid: trimmed })
      .andWhere(
        'project.organizationId IN (SELECT m.organization_id FROM organization_memberships m WHERE m.user_id = :uid)',
        { uid: userId },
      )
      .getOne();
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return this.ensureProjectPublicId(project);
  }

  async findOne(idOrPublicId: string, userId: number) {
    return this.resolveProjectByIdentifier(idOrPublicId, userId);
  }

  private async assertProjectFitsRoute(
    project: Project,
    userId: number,
    organizationPublicId: string | null | undefined,
  ): Promise<void> {
    const orgRaw = parseOrganizationPublicIdParam(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      orgRaw,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS,
      },
    );
    if (project.organizationId !== ctx.internalId) {
      throw new NotFoundException('Project not found');
    }
  }

  async findOneWithRoute(
    idOrPublicId: string,
    userId: number,
    organizationPublicId?: string | null,
    options?: { requireOrgProjectView?: boolean },
  ) {
    const project = await this.findOne(idOrPublicId, userId);
    await this.assertProjectFitsRoute(project, userId, organizationPublicId);
    if (options?.requireOrgProjectView === true) {
      await this.organizationsService.assertMemberCanViewOrgProject(
        userId,
        project.organizationId,
      );
    }
    return project;
  }

  async update(
    idOrPublicId: string,
    updateProjectDto: UpdateProjectDto,
    userId: number,
    organizationPublicId?: string | null,
  ) {
    const project = await this.findOneWithRoute(
      idOrPublicId,
      userId,
      organizationPublicId,
      { requireOrgProjectView: true },
    );
    const updated = this.projectRepository.merge(project, updateProjectDto);
    const saved = await this._internal_system_saveProject(updated);
    this.logProjectAudit(
      project.organizationId,
      userId,
      'security.project.updated',
      `PATCH /api/projects/${encodeURIComponent(idOrPublicId)}`,
      saved,
    );
    return saved;
  }

  async remove(
    idOrPublicId: string,
    userId: number,
    organizationPublicId?: string | null,
  ) {
    const project = await this.findOneWithRoute(
      idOrPublicId,
      userId,
      organizationPublicId,
    );
    await this.organizationsService.assertMemberCanDeleteOrgProject(
      userId,
      project.organizationId,
    );
    const services = project.services ?? [];
    if (services.length > 0) {
      throw new ConflictException(
        `Cannot delete project while it still contains services (${services.length}). Delete all services in this project first, then try again.`,
      );
    }
    const orgId = project.organizationId;
    const snapshot = {
      name: project.name,
      publicId: project.publicId,
    };
    await this._internal_system_removeProject(project);
    this.logProjectAudit(
      orgId,
      userId,
      'security.project.deleted',
      `DELETE /api/projects/${encodeURIComponent(idOrPublicId)}`,
      snapshot,
    );
  }
}
