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

@ApiTags('Docker Secrets')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/docker-secrets')
export class DockerSecretsController {
  constructor(private readonly secretsService: DockerSecretsService) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private parseRemoteServerId(raw: string | undefined): number {
    const n = parseInt(raw ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException(
        'Query parameter remoteServerId is required (positive integer). Secrets are managed on the remote Swarm manager over SSH.',
      );
    }
    return n;
  }

  @Get()
  @ApiOperation({ summary: 'List all secrets on a remote Docker host' })
  async findAll(@Query('remoteServerId') remoteServerIdStr: string, @Req() req: { user?: { userId: number } }) {
    const remoteServerId = this.parseRemoteServerId(remoteServerIdStr);
    return await this.secretsService.findAll(remoteServerId, this.uid(req));
  }

  @Get('paged')
  @ApiOperation({ summary: 'List secrets (paginated, search) on a remote host' })
  async findAllPaged(
    @Query('remoteServerId') remoteServerIdStr: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
    @Req() req?: { user?: { userId: number } },
  ) {
    const remoteServerId = this.parseRemoteServerId(remoteServerIdStr);
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
  async create(@Body() dto: CreateDockersecretDto, @Req() req: { user?: { userId: number } }) {
    await this.secretsService.create(
      dto.remoteServerId,
      this.uid(req),
      dto.name,
      dto.value,
    );
    return { success: true, name: dto.name };
  }

  @Post('bulk-import')
  @ApiOperation({ summary: 'Import from .env onto a remote host' })
  async bulkImport(@Body() dto: BulkImportDto, @Req() req: { user?: { userId: number } }) {
    const lines = dto.envText.split('\n');

    const results: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');

        if (key && valueParts.length > 0) {
          const name = key.trim();
          const value = valueParts.join('=').trim();

          try {
            await this.secretsService.create(
              dto.remoteServerId,
              this.uid(req),
              name,
              value,
            );
            results.push(name);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            errors.push({
              key: name,
              error: msg,
            });
          }
        }
      }
    }

    return {
      message: `${results.length} secrets processed.`,
      created: results,
      failed: errors,
    };
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete a secret on a remote host' })
  async remove(
    @Param('name') name: string,
    @Query('remoteServerId') remoteServerIdStr: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const remoteServerId = this.parseRemoteServerId(remoteServerIdStr);
    return await this.secretsService.remove(remoteServerId, this.uid(req), name, false);
  }

  @Get(':name/inspect')
  @ApiOperation({ summary: 'Inspect secret metadata on a remote host' })
  async inspect(
    @Param('name') name: string,
    @Query('remoteServerId') remoteServerIdStr: string,
    @Req() req: { user?: { userId: number } },
  ) {
    const remoteServerId = this.parseRemoteServerId(remoteServerIdStr);
    return await this.secretsService.findOne(remoteServerId, this.uid(req), name);
  }
}
