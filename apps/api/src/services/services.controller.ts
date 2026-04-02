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
  UsePipes,
  ValidationPipe,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { DatabaseSetupDto } from './dto/database-setup.dto';
import { PostgresStackUpdateDto } from './dto/postgres-stack-update.dto';
import { UploadApplicationZipDto } from './dto/upload-application-zip.dto';
import { PatchApplicationNetworksDto } from './dto/patch-application-networks.dto';
import type { DatabaseEngine } from './database-generator.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';

@ApiTags('Services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  private parseEngineOrThrow(engine: string): DatabaseEngine {
    const e = engine.toLowerCase();
    if (
      e === 'postgres' ||
      e === 'mysql' ||
      e === 'mariadb' ||
      e === 'mongodb' ||
      e === 'redis'
    ) {
      return e;
    }
    throw new BadRequestException('Unsupported database engine');
  }

  @Post()
  @ApiOperation({ summary: 'Create service record' })
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @Post(':id/database/postgres')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Generate Postgres docker-compose from form fields and save to dockerConfig',
  })
  applyPostgresDatabase(
    @Param('id') id: string,
    @Body() dto: DatabaseSetupDto,
  ) {
    return this.servicesService.applyPostgresDatabase(+id, dto);
  }

  @Post(':id/database/:engine')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Generate database docker-compose from form fields and save to dockerConfig (postgres/mysql/mariadb/mongodb/redis)',
  })
  applyDatabaseByEngine(
    @Param('id') id: string,
    @Param('engine') engine: string,
    @Body() dto: DatabaseSetupDto,
  ) {
    return this.servicesService.applyDatabase(
      +id,
      this.parseEngineOrThrow(engine),
      dto,
    );
  }

  @Patch(':id/database/postgres/stack')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Update Postgres stack YAML: optional publishPort (null = unpublish) and/or replicas (1–10). Omitted fields keep current values.',
  })
  updatePostgresStack(
    @Param('id') id: string,
    @Body() dto: PostgresStackUpdateDto,
  ) {
    return this.servicesService.updatePostgresStack(+id, dto);
  }

  @Patch(':id/database/:engine/stack')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Update database stack YAML by engine: optional publishPort (null = unpublish) and/or replicas (1–10). Omitted fields keep current values.',
  })
  updateDatabaseStackByEngine(
    @Param('id') id: string,
    @Param('engine') engine: string,
    @Body() dto: PostgresStackUpdateDto,
  ) {
    return this.servicesService.updateDatabaseStack(
      +id,
      this.parseEngineOrThrow(engine),
      dto,
    );
  }

  @Post(':id/execute')
  @ApiOperation({
    summary:
      'Deploy (build), reload (compose --no-build / stack deploy), or redeploy (compose stop + build + up; stack deploy + forced rolling restart)',
  })
  execute(
    @Param('id') id: string,
    @Body() body?: { mode?: 'deploy' | 'reload' | 'redeploy' },
  ) {
    const m = body?.mode;
    const mode =
      m === 'reload' ? 'reload' : m === 'redeploy' ? 'redeploy' : 'deploy';
    return this.servicesService.executeDeployment(+id, mode);
  }

  @Post(':id/application/upload')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Upload application ZIP, extract source, generate stack config (Dockerfile auto-detect or Cloud Native Buildpacks)',
  })
  uploadApplicationZip(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadApplicationZipDto,
    @Req() req: Request,
  ) {
    const raw = req.body as Record<string, unknown>;
    const fromDto =
      typeof dto.networksJson === 'string' && dto.networksJson.trim()
        ? dto.networksJson.trim()
        : undefined;
    const fromRaw =
      typeof raw?.networksJson === 'string' && String(raw.networksJson).trim()
        ? String(raw.networksJson).trim()
        : undefined;
    const networksJson = fromDto ?? fromRaw;

    const extFromDto = typeof dto.externalNetworks === 'string' ? dto.externalNetworks : undefined;
    const extFromRaw =
      typeof raw?.externalNetworks === 'string' ? String(raw.externalNetworks) : undefined;
    const externalNetworks = extFromDto ?? extFromRaw;

    const stkFromDto = typeof dto.stackNetworks === 'string' ? dto.stackNetworks : undefined;
    const stkFromRaw =
      typeof raw?.stackNetworks === 'string' ? String(raw.stackNetworks) : undefined;
    const stackNetworks = stkFromDto ?? stkFromRaw;

    return this.servicesService.uploadApplicationArchive(+id, file, {
      ...dto,
      ...(networksJson !== undefined ? { networksJson } : {}),
      ...(externalNetworks !== undefined ? { externalNetworks } : {}),
      ...(stackNetworks !== undefined ? { stackNetworks } : {}),
    });
  }

  @Patch(':id/application/networks')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Update application networks (multiple external + multiple stack overlays) and regenerate compose YAML',
  })
  patchApplicationNetworks(
    @Param('id') id: string,
    @Body() dto: PatchApplicationNetworksDto,
  ) {
    return this.servicesService.patchApplicationNetworks(+id, dto);
  }

  @Post(':id/start')
  @ApiOperation({
    summary: 'Start stopped containers (compose start / up --no-build)',
  })
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
  @ApiOperation({
    summary: 'Whether Docker reports running containers for this service',
  })
  async runtime(@Param('id') id: string) {
    return await this.servicesService.getRuntimeStatus(+id);
  }

  @Get(':id/volumes')
  @ApiOperation({
    summary:
      'Compose-declared volume/bind mounts for this service (docker compose config)',
  })
  async serviceVolumes(@Param('id') id: string) {
    return await this.servicesService.getServiceVolumes(+id);
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
      map(
        (log) =>
          ({
            data: log.data,
          }) as MessageEvent,
      ),
    );
  }

  @Post(':id/shutdown')
  @ApiOperation({ summary: 'Shutdown service without deleting configuration' })
  async shutdown(@Param('id') id: string) {
    return await this.servicesService.shutdownService(+id);
  }
}
