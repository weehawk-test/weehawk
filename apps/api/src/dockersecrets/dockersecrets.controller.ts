import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DockerSecretsService } from './dockersecrets.service';
import {
  BulkImportDto,
  CreateDockersecretDto,
} from './dto/create-dockersecret.dto';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { RemoteServersService } from '../remote-servers/remote-servers.service';

@ApiTags('Docker Secrets')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/docker-secrets')
export class DockerSecretsController {
  constructor(
    private readonly secretsService: DockerSecretsService,
    private readonly remoteServersService: RemoteServersService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private async parseRemoteServerId(
    raw: string | number | undefined,
    req?: { user?: { userId?: number } },
  ): Promise<number> {
    const t = String(raw ?? '').trim();
    if (!t) {
      throw new BadRequestException(
        'Query parameter remoteServerId is required (remote server id or publicId). Secrets are managed on the remote Swarm manager over SSH.',
      );
    }
    return this.remoteServersService.resolveDockerManagerServerIdForUser(
      t,
      this.uid(req),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all secrets on a remote Docker host' })
  async findAll(
    @Query('remoteServerId') remoteServerIdStr: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const remoteServerId = await this.parseRemoteServerId(
      remoteServerIdStr,
      req,
    );
    return await this.secretsService.findAll(remoteServerId, this.uid(req));
  }

  @Get('paged')
  @ApiOperation({
    summary: 'List secrets (paginated, search) on a remote host',
  })
  async findAllPaged(
    @Query('remoteServerId') remoteServerIdStr: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
    @Req() req?: { user?: { userId: number } },
  ) {
    const remoteServerId = await this.parseRemoteServerId(
      remoteServerIdStr,
      req,
    );
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return await this.secretsService.findAllPaged(
      remoteServerId,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a secret on a remote host' })
  async create(
    @Body() dto: CreateDockersecretDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const remoteServerId = await this.parseRemoteServerId(
      dto.remoteServerId,
      req,
    );
    await this.secretsService.create(
      remoteServerId,
      this.uid(req),
      dto.name,
      dto.value,
    );
    return { success: true, name: dto.name };
  }

  @Post('bulk-import')
  @ApiOperation({ summary: 'Import from .env onto a remote host' })
  async bulkImport(
    @Body() dto: BulkImportDto,
    @Req() req: { user?: { userId: number } },
  ) {
    const remoteServerId = await this.parseRemoteServerId(
      dto.remoteServerId,
      req,
    );
    return await this.secretsService.bulkImportFromEnvText(
      remoteServerId,
      this.uid(req),
      dto.envText,
    );
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete a secret on a remote host' })
  async remove(
    @Param('name') name: string,
    @Query('remoteServerId') remoteServerIdStr: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const remoteServerId = await this.parseRemoteServerId(
      remoteServerIdStr,
      req,
    );
    return await this.secretsService.remove(
      remoteServerId,
      this.uid(req),
      name,
      false,
    );
  }

  @Get(':name/inspect')
  @ApiOperation({ summary: 'Inspect secret metadata on a remote host' })
  async inspect(
    @Param('name') name: string,
    @Query('remoteServerId') remoteServerIdStr: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const remoteServerId = await this.parseRemoteServerId(
      remoteServerIdStr,
      req,
    );
    return await this.secretsService.findOne(
      remoteServerId,
      this.uid(req),
      name,
    );
  }
}
