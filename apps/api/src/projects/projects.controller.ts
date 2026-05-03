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

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
/** `/api/projects` matches other controllers (`/api/user`, …) and typical `/api` ingress to this service. */
@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new project container' })
  create(
    @Body() createProjectDto: CreateProjectDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.projectsService.create(createProjectDto, this.uid(req));
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
      'When set, list projects linked to this organization (membership required)',
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
    const orgRaw = organizationPublicId?.trim();
    if (orgRaw) {
      const ctx = await this.organizationsService.requireMemberContext(
        orgRaw,
        this.uid(req),
        {
          requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS,
        },
      );
      return this.projectsService.findAllPaginatedForOrganization(
        ctx.internalId,
        page,
        limit,
        q ?? '',
      );
    }
    return this.projectsService.findAllPaginated(
      page,
      limit,
      q ?? '',
      this.uid(req),
    );
  }

  @Get(':publicId')
  @ApiOperation({ summary: 'Get project details and its services' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'When calling from an organization workspace, pass the org publicId so org projects resolve; omit for personal-only projects',
  })
  async findOne(
    @Param('publicId') publicId: string,
    @Query('organizationPublicId') organizationPublicId: string | undefined,
    @Req() req: { user?: { userId: number } },
  ) {
    const project = await this.projectsService.findOneWithRoute(
      publicId,
      this.uid(req),
      organizationPublicId,
      { requireOrgProjectView: true },
    );
    let organizationPublicIdOut: string | undefined;
    if (project.organizationId != null) {
      const op = await this.organizationsService.getPublicIdByInternalId(
        project.organizationId,
      );
      organizationPublicIdOut = op ?? undefined;
    }
    return Object.assign(project, {
      organizationPublicId: organizationPublicIdOut,
    });
  }

  @Patch(':publicId')
  @ApiOperation({ summary: 'update project' })
  @ApiQuery({ name: 'organizationPublicId', required: false })
  update(
    @Param('publicId') publicId: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @Query('organizationPublicId') organizationPublicId: string | undefined,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.projectsService.update(
      publicId,
      updateProjectDto,
      this.uid(req),
      organizationPublicId,
    );
  }

  @Delete(':publicId')
  @ApiOperation({ summary: 'delete project' })
  @ApiQuery({ name: 'organizationPublicId', required: false })
  remove(
    @Param('publicId') publicId: string,
    @Query('organizationPublicId') organizationPublicId: string | undefined,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.projectsService.remove(
      publicId,
      this.uid(req),
      organizationPublicId,
    );
  }
}
