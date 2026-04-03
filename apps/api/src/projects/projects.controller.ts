import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new project container' })
  create(@Body() createProjectDto: CreateProjectDto) {
    return this.projectsService.create(createProjectDto);
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
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const limit = parseInt(limitStr ?? '9', 10);
    return this.projectsService.findAllPaginated(page, limit, q ?? '');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details and its services' })
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'update project' })
  update(@Param('id') id: string, @Body() updateProjectDto: UpdateProjectDto) {
    return this.projectsService.update(+id, updateProjectDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'delete project' })
  remove(@Param('id') id: string) {
    return this.projectsService.remove(+id);
  }
}
