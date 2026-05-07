import {
  UnauthorizedException,
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
import { RemoteImportBackupInterceptor } from './remote-import-backup.interceptor';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { RollMagicTraefikMeDto } from './dto/roll-magic-traefik-me.dto';
import { DatabaseSetupDto } from './dto/database-setup.dto';
import { PostgresStackUpdateDto } from './dto/postgres-stack-update.dto';
import { ApplicationGitCloneStageDto } from './dto/application-git-clone-stage.dto';
import { ApplicationGenerateFromSourceDto } from './dto/application-generate-from-source.dto';
import { PatchApplicationNetworksDto } from './dto/patch-application-networks.dto';
import { PatchApplicationVolumesDto } from './dto/patch-application-volumes.dto';
import { PatchApplicationEnvDto } from './dto/patch-application-env.dto';
import { PatchApplicationImageDeployDto } from './dto/patch-application-image.dto';
import { RunServiceBackupDto } from './dto/run-service-backup.dto';
import { ImportServiceBackupFromS3Dto } from './dto/import-service-backup-from-s3.dto';
import type { DatabaseEngine } from './database-generator.service';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { EventEmitter } from 'events';
import { Observable, map } from 'rxjs';
import { LocalSessionGuard } from '../common/guards/local-session.guard';

@ApiTags('Services')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private async sid(
    id: string,
    req: { user?: { userId: number } },
  ): Promise<number> {
    return this.servicesService.resolveServiceIdForUser(id, this.uid(req));
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
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
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
    return this.sid(id, req).then((resolvedId) =>
      this.servicesService.applyPostgresDatabase(
        resolvedId,
        dto,
        this.uid(req),
      ),
    );
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
    return this.sid(id, req).then((resolvedId) =>
      this.servicesService.applyDatabase(
        resolvedId,
        this.parseEngineOrThrow(engine),
        dto,
        this.uid(req),
      ),
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
    return this.sid(id, req).then((resolvedId) =>
      this.servicesService.updatePostgresStack(resolvedId, dto, this.uid(req)),
    );
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
    return this.sid(id, req).then((resolvedId) =>
      this.servicesService.updateDatabaseStack(
        resolvedId,
        this.parseEngineOrThrow(engine),
        dto,
        this.uid(req),
      ),
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
    return this.sid(id, req!).then((resolvedId) =>
      this.servicesService.executeDeployment(resolvedId, mode, {
        actingUserId: this.uid(req),
      }),
    );
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
    return this.sid(id, req).then((resolvedId) =>
      this.servicesService.syncRemoteDeploymentMirror(
        resolvedId,
        this.uid(req),
      ),
    );
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
  async streamDeploy(
    @Param('id') id: string,
    @Query('mode') modeRaw: string | undefined,
    @Req() req: { user?: { userId: number } },
  ): Promise<Observable<MessageEvent>> {
    const resolvedId = await this.sid(id, req);
    const mode =
      modeRaw === 'reload'
        ? 'reload'
        : modeRaw === 'redeploy'
          ? 'redeploy'
          : 'deploy';
    return new Observable((observer) => {
      const emitter = new EventEmitter();
      emitter.on('data', (chunk: string) => {
        observer.next({
          data: JSON.stringify({ data: chunk }),
        } as MessageEvent);
      });
      void this.servicesService
        .executeDeployment(resolvedId, mode, {
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
  async backupNow(
    @Param('id') id: string,
    @Body() dto: RunServiceBackupDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.runServiceBackupNow(
      this.uid(req),
      resolvedId,
      dto,
    );
  }

  @Post(':id/backup/import')
  @UseInterceptors(RemoteImportBackupInterceptor)
  @ApiOperation({
    summary:
      'Import a DB dump or volume .tar.gz: multipart bytes stream over SSH to the deploy host only (not stored on the API server)',
  })
  async importBackup(
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
    const resolvedId = await this.sid(id, req);
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
      resolvedId,
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
      'Import database or volume backup from S3 (presigned download on the deploy host; API does not store the object)',
  })
  async importBackupFromS3(
    @Param('id') id: string,
    @Body() dto: ImportServiceBackupFromS3Dto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.runServiceImportBackupFromS3(
      resolvedId,
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
      'Resolve Git ref and store binding in dockerConfig (no app files on API). Then POST generate-from-source with port/env.',
  })
  async stageApplicationGitClone(
    @Param('id') id: string,
    @Body() dto: ApplicationGitCloneStageDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.stageApplicationGitClone(
      resolvedId,
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
      'Generate application stack from stored remote-git binding (after git-clone-stage or to re-apply options)',
  })
  async generateApplicationFromSource(
    @Param('id') id: string,
    @Body() dto: ApplicationGenerateFromSourceDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.generateApplicationFromSource(
      resolvedId,
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
  async patchApplicationNetworks(
    @Param('id') id: string,
    @Body() dto: PatchApplicationNetworksDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.patchApplicationNetworks(
      resolvedId,
      dto,
      this.uid(req),
    );
  }

  @Patch(':id/application/volumes')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Update application volumes and regenerate compose YAML',
  })
  async patchApplicationVolumes(
    @Param('id') id: string,
    @Body() dto: PatchApplicationVolumesDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.patchApplicationVolumes(
      resolvedId,
      dto,
      this.uid(req),
    );
  }

  @Patch(':id/application/env')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Update application environment values and regenerate compose YAML',
  })
  async patchApplicationEnv(
    @Param('id') id: string,
    @Body() dto: PatchApplicationEnvDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.patchApplicationEnv(
      resolvedId,
      dto,
      this.uid(req),
    );
  }

  @Patch(':id/application/image')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Configure application stack to run a pre-built Docker image (deploy skips docker build from source)',
  })
  async patchApplicationImage(
    @Param('id') id: string,
    @Body() dto: PatchApplicationImageDeployDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.setApplicationImageDeploy(
      resolvedId,
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
    const resolvedId = await this.sid(id, req);
    return await this.servicesService.startService(resolvedId, this.uid(req));
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
  async findAll(
    @Query('projectId') projectId?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('q') q?: string,
    @Query('all') allStr?: string,
    @Req() req?: { user?: { userId: number } },
  ) {
    const uid = this.uid(req);
    if (projectId !== undefined && projectId !== '') {
      const resolvedProjectId =
        await this.servicesService.resolveProjectIdForUser(projectId, uid);
      const all =
        allStr === '1' ||
        allStr === 'true' ||
        String(allStr).toLowerCase() === 'yes';
      if (all) {
        return this.servicesService.findByProjectId(resolvedProjectId, uid);
      }
      const page = parseInt(pageStr ?? '1', 10);
      const limit = parseInt(limitStr ?? '8', 10);
      return this.servicesService.findByProjectIdPaginated(
        resolvedProjectId,
        page,
        limit,
        q ?? '',
        uid,
      );
    }
    return this.servicesService.findAll(uid);
  }

  @Get('runtime/snapshot')
  @ApiOperation({
    summary:
      'Runtime snapshot for all services in a project (single request, event-driven updates afterwards)',
  })
  @ApiQuery({ name: 'projectId', required: true })
  async runtimeSnapshot(
    @Query('projectId') projectId: string,
    @Req() req: { user?: { userId: number } },
  ) {
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId is required');
    }
    const uid = this.uid(req);
    const resolvedProjectId =
      await this.servicesService.resolveProjectIdForUser(projectId, uid);
    return this.servicesService.getProjectRuntimeSnapshot(resolvedProjectId, uid);
  }

  @Get(':id/runtime')
  @ApiOperation({
    summary: 'Whether Docker reports running containers for this service',
  })
  async runtime(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return await this.servicesService.getRuntimeStatus(
      resolvedId,
      this.uid(req),
    );
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
    const resolvedId = await this.sid(id, req);
    return await this.servicesService.getServiceVolumes(
      resolvedId,
      this.uid(req),
    );
  }

  @Post(':id/magic-traefik-me/roll')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Roll a Magic traefik.me hostname (manual opt-in). Optional body.publicIpv4 is saved on the service. Regenerates stack YAML when an application stack exists.',
  })
  async rollMagicTraefikMe(
    @Param('id') id: string,
    @Body() body: RollMagicTraefikMeDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.rollMagicTraefikMeDomain(
      resolvedId,
      this.uid(req),
      body,
    );
  }

  @Delete(':id/magic-traefik-me')
  @ApiOperation({
    summary:
      'Remove Magic traefik.me hostname from this service (updates stack YAML when present)',
  })
  async clearMagicTraefikMe(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.clearMagicTraefikMeDomain(
      resolvedId,
      this.uid(req),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service details' })
  async findOne(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    const s = await this.servicesService.getScopedServiceForUser(
      resolvedId,
      this.uid(req),
    );
    return this.servicesService.withMagicTraefikMeUrl(s);
  }

  @Patch(':id')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({ summary: 'Update service configuration' })
  async update(
    @Param('id') id: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.update(
      resolvedId,
      updateServiceDto,
      this.uid(req),
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Stop and delete service' })
  async remove(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.remove(resolvedId, this.uid(req));
  }

  @Sse(':id/logs/stream')
  @ApiOperation({ summary: 'Real-time log streaming' })
  async streamLogs(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ): Promise<Observable<MessageEvent>> {
    const resolvedId = await this.sid(id, req);
    return this.servicesService
      .getServiceLogsStream(resolvedId, this.uid(req))
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
    const resolvedId = await this.sid(id, req);
    return await this.servicesService.shutdownService(
      resolvedId,
      this.uid(req),
    );
  }

  @Get(':id/auto-deploy')
  @ApiOperation({ summary: 'Get auto-deploy settings for a service' })
  async getAutoDeploy(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.getAutoDeploySettings(
      resolvedId,
      this.uid(req),
    );
  }

  @Post(':id/auto-deploy')
  @ApiOperation({
    summary: 'Configure auto-deploy (enable/disable) for a service',
  })
  async configureAutoDeploy(
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
    const resolvedId = await this.sid(id, req);
    return this.servicesService.configureAutoDeploy(
      resolvedId,
      this.uid(req),
      body,
    );
  }

  @Post(':id/auto-deploy/resync')
  @ApiOperation({
    summary:
      'Re-register auto-deploy hooks on GitHub/GitLab after webhook URL changes',
  })
  async resyncAutoDeployHooks(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const resolvedId = await this.sid(id, req);
    return this.servicesService.resyncAutoDeployHooks(
      resolvedId,
      this.uid(req),
    );
  }
}
