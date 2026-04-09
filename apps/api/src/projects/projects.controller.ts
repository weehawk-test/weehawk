import {
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
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
/** `/api/projects` matches other controllers (`/api/user`, …) and typical `/api` ingress to this service. */
@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  private uid(_req?: unknown): number {
    return 1;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new project container' })
  create(
    @Body() createProjectDto: CreateProjectDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.projectsService.create(createProjectDto, this.uid());
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
  findAll(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('q') q?: string,
    @Req() req?: { user?: { userId: number } },
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const limit = parseInt(limitStr ?? '9', 10);
    return this.projectsService.findAllPaginated(
      page,
      limit,
      q ?? '',
      this.uid(),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details and its services' })
  findOne(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.projectsService.findOne(+id, this.uid());
  }

  @Patch(':id')
  @ApiOperation({ summary: 'update project' })
  update(
    @Param('id') id: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.projectsService.update(+id, updateProjectDto, this.uid());
  }

  @Delete(':id')
  @ApiOperation({ summary: 'delete project' })
  remove(@Param('id') id: string, @Req() req: { user?: { userId: number } }) {
    return this.projectsService.remove(+id, this.uid());
  }
}
