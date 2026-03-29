import { Controller, Get, Delete, Param, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
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

  @Delete('containers/:id')
  @ApiOperation({ summary: 'Remove a container (force)' })
  async removeContainer(@Param('id') id: string) {
    return await this.dockerService.removeContainer(decodeURIComponent(id));
  }

  @Get('images')
  @ApiOperation({ summary: 'Get all downloaded images' })
  async images() {
    return await this.dockerService.getImages();
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

  @Delete('volumes/:name')
  @ApiOperation({ summary: 'Remove a volume' })
  async removeVolume(@Param('name') name: string) {
    return await this.dockerService.removeVolume(decodeURIComponent(name));
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get real-time CPU/RAM stats' })
  async stats() {
    return await this.dockerService.getSystemStats();
  }
}