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
  UseGuards,
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
import { RollMagicTraefikMeDto } from './dto/roll-magic-traefik-me.dto';
import { DatabaseSetupDto } from './dto/database-setup.dto';
import { PostgresStackUpdateDto } from './dto/postgres-stack-update.dto';
import { UploadApplicationZipDto } from './dto/upload-application-zip.dto';
import { ApplicationGitCloneDto } from './dto/application-git-clone.dto';
import { ApplicationGitCloneStageDto } from './dto/application-git-clone-stage.dto';
import { ApplicationGenerateFromSourceDto } from './dto/application-generate-from-source.dto';
import { PatchApplicationNetworksDto } from './dto/patch-application-networks.dto';
import { PatchApplicationImageDeployDto } from './dto/patch-application-image.dto';
import { RunServiceBackupDto } from './dto/run-service-backup.dto';
import { ImportServiceBackupFromS3Dto } from './dto/import-service-backup-from-s3.dto';
import type { DatabaseEngine } from './database-generator.service';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EventEmitter } from 'events';
import { Observable, map } from 'rxjs';
import { LocalSessionGuard } from '../common/guards/local-session.guard';

@ApiTags('Services')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  private uid(_req?: unknown): number {
    return 1;
  }

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
  create(
    @Body() createServiceDto: CreateServiceDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.create(createServiceDto, this.uid(req));
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
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.applyPostgresDatabase(+id, dto, this.uid(req));
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
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.applyDatabase(
      +id,
      this.parseEngineOrThrow(engine),
      dto,
      this.uid(req),
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
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.updatePostgresStack(+id, dto, this.uid(req));
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
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.updateDatabaseStack(
      +id,
      this.parseEngineOrThrow(engine),
      dto,
      this.uid(req),
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
    @Req() req?: { user?: { userId: number } },
  ) {
    const m = body?.mode;
    const mode =
      m === 'reload' ? 'reload' : m === 'redeploy' ? 'redeploy' : 'deploy';
    return this.servicesService.executeDeployment(+id, mode, {
      actingUserId: this.uid(req!),
    });
  }

  @Post(':id/sync-remote-deployment-mirror')
  @ApiOperation({
    summary:
      'Copy saved compose (and Swarm registry/env files) to the deploy host persistent dir without running docker deploy',
  })
  syncRemoteDeploymentMirror(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.syncRemoteDeploymentMirror(+id, this.uid(req));
  }

  /**
   * Same deploy as `POST :id/execute`, but streams stdout/stderr chunks over SSE (like local `docker` on the API host).
   * Query: `mode` = deploy | reload | redeploy (default deploy).
   */
  @Sse(':id/deploy/stream')
  @ApiOperation({
    summary:
      'Deploy with streamed log output (SSE). Chunks use `{ data: string }`; final message `{ done, success, output }`.',
  })
  streamDeploy(
    @Param('id') id: string,
    @Query('mode') modeRaw: string | undefined,
    @Req() req: { user?: { userId: number } },
  ): Observable<MessageEvent> {
    const mode =
      modeRaw === 'reload' ? 'reload' : modeRaw === 'redeploy' ? 'redeploy' : 'deploy';
    return new Observable((observer) => {
      const emitter = new EventEmitter();
      emitter.on('data', (chunk: string) => {
        observer.next({ data: JSON.stringify({ data: chunk }) } as MessageEvent);
      });
      void this.servicesService
        .executeDeployment(+id, mode, {
          actingUserId: this.uid(req),
          deployLogEmitter: emitter,
        })
        .then((result) => {
          observer.next({
            data: JSON.stringify({
              done: true,
              success: result.success,
              output: result.output ?? '',
            }),
          } as MessageEvent);
          observer.complete();
        })
        .catch((e: Error) => {
          observer.next({
            data: JSON.stringify({
              done: true,
              success: false,
              output: e?.message ?? String(e),
            }),
          } as MessageEvent);
          observer.complete();
        });
    });
  }

  @Post(':id/backup')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Run one-off volume or database backup and upload to S3',
  })
  backupNow(
    @Param('id') id: string,
    @Body() dto: RunServiceBackupDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.runServiceBackupNow(
      this.uid(req),
      +id,
      dto,
    );
  }

  @Post(':id/backup/import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 512 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary:
      'Import a database dump or a volume .tar.gz backup (multipart file; runs on host)',
  })
  importBackup(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: {
      action?: string;
      databaseBackupConfig?: string;
      volumeSource?: string;
    },
    @Req() req: { user?: { userId: number } },
  ) {
    if (!file) {
      throw new BadRequestException('file is required.');
    }
    const action = body?.action;
    if (action !== 'import_database' && action !== 'import_volume') {
      throw new BadRequestException(
        'action must be import_database or import_volume.',
      );
    }
    return this.servicesService.runServiceImportBackup(
      this.uid(req),
      +id,
      file,
      action,
      body.databaseBackupConfig,
      body.volumeSource,
    );
  }

  @Post(':id/backup/import-from-s3')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Import database or volume backup from an object in a saved S3 profile (server downloads then imports)',
  })
  importBackupFromS3(
    @Param('id') id: string,
    @Body() dto: ImportServiceBackupFromS3Dto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.runServiceImportBackupFromS3(
      +id,
      dto,
      this.uid(req),
    );
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
    @Req() req: Request & { user?: { userId: number } },
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

    return this.servicesService.uploadApplicationArchive(
      +id,
      file,
      this.uid(req),
      {
        ...dto,
        ...(networksJson !== undefined ? { networksJson } : {}),
        ...(externalNetworks !== undefined ? { externalNetworks } : {}),
        ...(stackNetworks !== undefined ? { stackNetworks } : {}),
      },
    );
  }

  @Post(':id/application/git-clone')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary:
      'Clone a GitLab repository into app source (requires `git` on the API host; GitLab personal/group token in Git settings)',
  })
  uploadApplicationGitClone(
    @Param('id') id: string,
    @Body() dto: ApplicationGitCloneDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.uploadApplicationFromGitClone(
      +id,
      dto,
      this.uid(req),
    );
  }

  @Post(':id/application/git-clone-stage')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary:
      'Clone Git repository into app source only (no stack yet). Then POST generate-from-source with port/env.',
  })
  stageApplicationGitClone(
    @Param('id') id: string,
    @Body() dto: ApplicationGitCloneStageDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.stageApplicationGitClone(
      +id,
      dto,
      this.uid(req),
    );
  }

  @Post(':id/application/generate-from-source')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary:
      'Generate application stack from existing app-source (after git-clone-stage or to re-apply options)',
  })
  generateApplicationFromSource(
    @Param('id') id: string,
    @Body() dto: ApplicationGenerateFromSourceDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.generateApplicationFromSource(
      +id,
      dto,
      this.uid(req),
    );
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
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.patchApplicationNetworks(
      +id,
      dto,
      this.uid(req),
    );
  }

  @Patch(':id/application/image')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Configure application stack to run a pre-built Docker image (no source ZIP; deploy skips docker build)',
  })
  patchApplicationImage(
    @Param('id') id: string,
    @Body() dto: PatchApplicationImageDeployDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.setApplicationImageDeploy(
      +id,
      dto,
      this.uid(req),
    );
  }

  @Post(':id/start')
  @ApiOperation({
    summary: 'Start stopped containers (compose start / up --no-build)',
  })
  async start(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return await this.servicesService.startService(+id, this.uid(req));
  }

  @Get()
  @ApiOperation({
    summary:
      'List all services, or paginated list for a project (default 8 per page)',
  })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 8 })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by name or description (when projectId is set)',
  })
  @ApiQuery({
    name: 'all',
    required: false,
    description:
      'If true with projectId, return full array (no pagination). Omit for paged list.',
  })
  findAll(
    @Query('projectId') projectId?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('q') q?: string,
    @Query('all') allStr?: string,
    @Req() req?: { user?: { userId: number } },
  ) {
    const uid = this.uid(req!);
    if (projectId !== undefined && projectId !== '') {
      const n = Number(projectId);
      if (!Number.isFinite(n)) {
        throw new BadRequestException('Invalid projectId');
      }
      const all =
        allStr === '1' ||
        allStr === 'true' ||
        String(allStr).toLowerCase() === 'yes';
      if (all) {
        return this.servicesService.findByProjectId(n, uid);
      }
      const page = parseInt(pageStr ?? '1', 10);
      const limit = parseInt(limitStr ?? '8', 10);
      return this.servicesService.findByProjectIdPaginated(
        n,
        page,
        limit,
        q ?? '',
        uid,
      );
    }
    return this.servicesService.findAll(uid);
  }

  @Get(':id/runtime')
  @ApiOperation({
    summary: 'Whether Docker reports running containers for this service',
  })
  async runtime(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return await this.servicesService.getRuntimeStatus(+id, this.uid(req));
  }

  @Get(':id/volumes')
  @ApiOperation({
    summary:
      'Compose-declared volume/bind mounts for this service (docker compose config)',
  })
  async serviceVolumes(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return await this.servicesService.getServiceVolumes(+id, this.uid(req));
  }

  @Post(':id/magic-traefik-me/roll')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Roll a Magic traefik.me hostname (manual opt-in). Optional body.publicIpv4 is saved on the service. Regenerates stack YAML when an application stack exists.',
  })
  rollMagicTraefikMe(
    @Param('id') id: string,
    @Body() body: RollMagicTraefikMeDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.rollMagicTraefikMeDomain(
      +id,
      this.uid(req),
      body,
    );
  }

  @Delete(':id/magic-traefik-me')
  @ApiOperation({
    summary: 'Remove Magic traefik.me hostname from this service (updates stack YAML when present)',
  })
  clearMagicTraefikMe(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.clearMagicTraefikMeDomain(+id, this.uid(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service details' })
  async findOne(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const s = await this.servicesService.assertServiceOwnedByUser(
      +id,
      this.uid(req),
    );
    return this.servicesService.withMagicTraefikMeUrl(s);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update service configuration' })
  update(
    @Param('id') id: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.update(+id, updateServiceDto, this.uid(req));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Stop and delete service' })
  remove(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.remove(+id, this.uid(req));
  }

  @Sse(':id/logs/stream')
  @ApiOperation({ summary: 'Real-time log streaming' })
  streamLogs(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ): Observable<MessageEvent> {
    return this.servicesService
      .getServiceLogsStream(+id, this.uid(req))
      .pipe(
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
  async shutdown(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return await this.servicesService.shutdownService(+id, this.uid(req));
  }

  @Get(':id/auto-deploy')
  @ApiOperation({ summary: 'Get auto-deploy settings for a service' })
  getAutoDeploy(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.getAutoDeploySettings(+id, this.uid(req));
  }

  @Post(':id/auto-deploy')
  @ApiOperation({ summary: 'Configure auto-deploy (enable/disable) for a service' })
  configureAutoDeploy(
    @Param('id') id: string,
    @Body()
    body: {
      enabled: boolean;
      branch?: string;
      gitProvider?: string | null;
      repoId?: string | null;
    },
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.configureAutoDeploy(+id, this.uid(req), body);
  }

  @Post(':id/auto-deploy/resync')
  @ApiOperation({ summary: 'Re-register auto-deploy hooks on GitHub/GitLab after webhook URL changes' })
  resyncAutoDeployHooks(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.servicesService.resyncAutoDeployHooks(+id, this.uid(req));
  }
}
