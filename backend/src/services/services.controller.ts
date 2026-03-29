import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Delete, 
  Sse, 
  MessageEvent,
  Patch,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';

@ApiTags('Services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @ApiOperation({ summary: 'Create service record' })
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @Post(':id/execute')
  @ApiOperation({ summary: 'Deploy (build) or reload (no build) — body: { mode?: "deploy" | "reload" }' })
  execute(@Param('id') id: string, @Body() body?: { mode?: 'deploy' | 'reload' }) {
    const mode = body?.mode === 'reload' ? 'reload' : 'deploy';
    return this.servicesService.executeDeployment(+id, mode);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start stopped containers (compose start / up --no-build)' })
  async start(@Param('id') id: string) {
    return await this.servicesService.startService(+id);
  }

  @Get()
  @ApiOperation({ summary: 'List all services, or filter by projectId' })
  findAll(@Query('projectId') projectId?: string) {
    if (projectId !== undefined && projectId !== '') {
      const n = Number(projectId);
      if (!Number.isFinite(n)) {
        throw new BadRequestException('Invalid projectId');
      }
      return this.servicesService.findByProjectId(n);
    }
    return this.servicesService.findAll();
  }

  @Get(':id/runtime')
  @ApiOperation({ summary: 'Whether Docker reports running containers for this service' })
  async runtime(@Param('id') id: string) {
    return await this.servicesService.getRuntimeStatus(+id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service details' })
  findOne(@Param('id') id: string) {
    return this.servicesService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update service configuration' })
  update(@Param('id') id: string, @Body() updateServiceDto: UpdateServiceDto) {
    return this.servicesService.update(+id, updateServiceDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Stop and delete service' })
  remove(@Param('id') id: string) {
    return this.servicesService.remove(+id);
  }

  @Sse(':id/logs/stream')
  @ApiOperation({ summary: 'Real-time log streaming' })
  streamLogs(@Param('id') id: string): Observable<MessageEvent> {
    return this.servicesService.getServiceLogsStream(+id).pipe(
      map((log) => ({
        data: log.data,
      } as MessageEvent)),
    );
  }

  @Post(':id/shutdown')
  @ApiOperation({ summary: 'Shutdown service without deleting configuration' })
  async shutdown(@Param('id') id: string) {
    return await this.servicesService.shutdownService(+id);
  }
}