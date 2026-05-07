import {
  UnauthorizedException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { OrganizationsService } from '../organizations/organizations.service';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';
import { ActiveOrganizationService } from '../organizations/active-organization.service';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
/** `/api/projects` matches other controllers (`/api/user`, …) and typical `/api` ingress to this service. */
@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly organizationsService: OrganizationsService,
    private readonly activeOrganizationService: ActiveOrganizationService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new project container' })
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const project = await this.projectsService.create(
      createProjectDto,
      this.uid(req),
    );
    const op = await this.organizationsService.getPublicIdByInternalId(
      project.organizationId,
    );
    return Object.assign(project, {
      organizationPublicId: op ?? undefined,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List projects (paginated, optional search)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 9 })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by name or description',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'Organization workspace (`org_...`). Optional if an active organization is set server-side.',
  })
  async findAll(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('q') q?: string,
    @Query('organizationPublicId') organizationPublicId?: string,
    @Req() req?: { user?: { userId: number } },
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const limit = parseInt(limitStr ?? '9', 10);
    const ctx = await this.activeOrganizationService.resolveRequiredMemberContext(
      this.uid(req),
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS,
      },
    );
    const pageResult = await this.projectsService.findAllPaginatedForOrganization(
      ctx.internalId,
      page,
      limit,
      q ?? '',
    );
    const orgPub = ctx.publicId;
    return {
      ...pageResult,
      data: pageResult.data.map((p) =>
        Object.assign(p, { organizationPublicId: orgPub }),
      ),
    };
  }

  @Get(':publicId')
  @ApiOperation({ summary: 'Get project details and its services' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'Active organization workspace (`org_…`). Optional if an active organization is set server-side.',
  })
  async findOne(
    @Param('publicId') publicId: string,
    @Query('organizationPublicId') organizationPublicId: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const ctx = await this.activeOrganizationService.resolveRequiredMemberContext(
      this.uid(req),
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS,
      },
    );
    const project = await this.projectsService.findOneWithRoute(
      publicId,
      this.uid(req),
      ctx.publicId,
      { requireOrgProjectView: true },
    );
    const op = await this.organizationsService.getPublicIdByInternalId(
      project.organizationId,
    );
    return Object.assign(project, {
      organizationPublicId: op ?? undefined,
    });
  }

  @Patch(':publicId')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({ summary: 'update project' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'Optional if an active organization is set server-side; otherwise required.',
  })
  async update(
    @Param('publicId') publicId: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @Query('organizationPublicId') organizationPublicId: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const ctx = await this.activeOrganizationService.resolveRequiredMemberContext(
      this.uid(req),
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS,
      },
    );
    const project = await this.projectsService.update(
      publicId,
      updateProjectDto,
      this.uid(req),
      ctx.publicId,
    );
    const op = await this.organizationsService.getPublicIdByInternalId(
      project.organizationId,
    );
    return Object.assign(project, {
      organizationPublicId: op ?? undefined,
    });
  }

  @Delete(':publicId')
  @ApiOperation({ summary: 'delete project' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'Optional if an active organization is set server-side; otherwise required.',
  })
  async remove(
    @Param('publicId') publicId: string,
    @Query('organizationPublicId') organizationPublicId: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const ctx = await this.activeOrganizationService.resolveRequiredMemberContext(
      this.uid(req),
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS,
      },
    );
    return this.projectsService.remove(
      publicId,
      this.uid(req),
      ctx.publicId,
    );
  }
}
