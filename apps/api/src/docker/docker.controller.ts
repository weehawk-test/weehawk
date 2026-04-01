import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { DockerService } from './docker.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('Docker Engine Monitor')
@Controller('docker-monitor')
export class DockerController {
  constructor(private readonly dockerService: DockerService) {}

  @Get('containers')
  @ApiOperation({ summary: 'Get all system containers' })
  async containers() {
    return await this.dockerService.getContainers();
  }

  @Get('containers/paged')
  @ApiOperation({ summary: 'List containers (paginated, optional search)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 10 })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by name or image',
  })
  async containersPaged(
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.dockerService.getContainersPaged(page, pageSize, q ?? '');
  }

  @Get('containers/:id/logs')
  @ApiOperation({ summary: 'Get recent container logs (stdout/stderr)' })
  @ApiQuery({
    name: 'tail',
    required: false,
    description: 'Number of lines (1–10000)',
    example: 500,
  })
  async containerLogs(
    @Param('id') id: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    return await this.dockerService.getContainerLogs(
      decodeURIComponent(id),
      tail,
    );
  }

  @Get('services')
  @ApiOperation({ summary: 'Get all docker services' })
  async services() {
    return await this.dockerService.getServices();
  }

  @Get('services/paged')
  @ApiOperation({ summary: 'List services (paginated, optional search)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 10 })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by service name, image, or mode',
  })
  async servicesPaged(
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.dockerService.getServicesPaged(page, pageSize, q ?? '');
  }

  @Get('services/:id/logs')
  @ApiOperation({ summary: 'Get recent service logs' })
  @ApiQuery({
    name: 'tail',
    required: false,
    description: 'Number of lines (1–10000)',
    example: 500,
  })
  async serviceLogs(
    @Param('id') id: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    return await this.dockerService.getServiceLogs(decodeURIComponent(id), tail);
  }

  @Delete('services/:id')
  @ApiOperation({ summary: 'Remove a service' })
  async removeService(
    @Param('id') id: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return await this.dockerService.removeService(decodeURIComponent(id), force);
  }

  @Delete('containers/:id')
  @ApiOperation({ summary: 'Remove a container (force)' })
  async removeContainer(
    @Param('id') id: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return await this.dockerService.removeContainer(
      decodeURIComponent(id),
      force,
    );
  }

  @Get('images')
  @ApiOperation({ summary: 'Get all downloaded images' })
  async images() {
    return await this.dockerService.getImages();
  }

  @Get('images/paged')
  @ApiOperation({ summary: 'List images (paginated, optional search)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by repository or tag',
  })
  async imagesPaged(
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.dockerService.getImagesPaged(page, pageSize, q ?? '');
  }

  @Delete('images')
  @ApiOperation({ summary: 'Remove an image by reference' })
  @ApiQuery({ name: 'ref', required: true, example: 'nginx:latest' })
  async removeImage(@Query('ref') ref: string) {
    return await this.dockerService.removeImage(decodeURIComponent(ref ?? ''));
  }

  @Get('volumes')
  @ApiOperation({ summary: 'Get all docker volumes' })
  async volumes() {
    return await this.dockerService.getVolumes();
  }

  @Get('volumes/paged')
  @ApiOperation({ summary: 'List volumes (paginated, optional search)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by volume name',
  })
  @ApiQuery({
    name: 'includeSizes',
    required: false,
    description:
      'When true, also resolves volume sizes (slower). Default: false.',
  })
  async volumesPaged(
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
    @Query('includeSizes') includeSizesStr?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    const includeSizes = (includeSizesStr ?? '').toLowerCase() === 'true';
    return this.dockerService.getVolumesPaged(
      page,
      pageSize,
      q ?? '',
      includeSizes,
    );
  }

  @Delete('volumes/:name')
  @ApiOperation({ summary: 'Remove a volume' })
  async removeVolume(
    @Param('name') name: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return await this.dockerService.removeVolume(decodeURIComponent(name), force);
  }

  @Get('networks')
  @ApiOperation({ summary: 'List Docker networks (docker network ls)' })
  async networks() {
    return await this.dockerService.getNetworks();
  }

  @Get('networks/paged')
  @ApiOperation({ summary: 'List networks (paginated, optional search)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by name, driver, scope, or id',
  })
  async networksPaged(
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.dockerService.getNetworksPaged(page, pageSize, q ?? '');
  }

  @Delete('networks/:id')
  @ApiOperation({ summary: 'Remove a network by name or id' })
  async removeNetwork(
    @Param('id') id: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return await this.dockerService.removeNetwork(decodeURIComponent(id), force);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get real-time CPU/RAM stats' })
  async stats() {
    return await this.dockerService.getSystemStats();
  }
}
