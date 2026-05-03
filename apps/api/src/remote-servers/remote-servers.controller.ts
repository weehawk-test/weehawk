import {
  UnauthorizedException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { RemoteServersService } from './remote-servers.service';
import { RemoteServerProvisionService } from './remote-server-provision.service';
import { CreateRemoteServerDto } from './dto/create-remote-server.dto';
import { UpdateRemoteServerDto } from './dto/update-remote-server.dto';
import { RunRemoteTerminalDto } from './dto/run-remote-terminal.dto';

@ApiTags('Remote servers')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/remote-servers')
export class RemoteServersController {
  constructor(
    private readonly remoteServersService: RemoteServersService,
    private readonly remoteServerProvisionService: RemoteServerProvisionService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private rid(id: string, req: { user?: { userId: number } }): Promise<number> {
    return this.remoteServersService.resolveServerIdForUser(id, this.uid(req));
  }

  @Get()
  @ApiOperation({ summary: 'List SSH / Docker remote hosts' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'When set, list remote servers for this organization (membership required). Omit for personal-account servers only.',
  })
  list(
    @Query('organizationPublicId') organizationPublicId: string | undefined,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.findAll(
      this.uid(req),
      organizationPublicId,
    );
  }

  @Get('provision-jobs/:jobId')
  @ApiOperation({
    summary:
      'Get remote server provision job status (Docker / Swarm / weehawk network); poll until done or error',
  })
  getProvisionJob(
    @Param('jobId') jobId: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServerProvisionService.getJob(jobId, this.uid(req));
  }

  @Get('provision-script')
  @ApiOperation({
    summary:
      'Preview the bash script run on the host when you click Install (Docker / Swarm / weehawk network for deploy role)',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    description: 'deploy (default) or build',
    enum: ['deploy', 'build'],
  })
  getProvisionScript(
    @Query('role') role?: string,
    @Req() req?: { user?: { userId: number } },
  ) {
    const r = role === 'build' ? 'build' : 'deploy';
    return this.remoteServerProvisionService.getProvisionScriptPreview(
      r,
      this.uid(req),
    );
  }

  @Get('docker-purge-script')
  @ApiOperation({
    summary:
      'Preview the destructive bash that purges Docker (use when old/conflicting packages block install)',
  })
  getDockerPurgeScript() {
    return this.remoteServerProvisionService.getDockerPurgeScriptPreview();
  }

  @Get('nixpacks-install-script')
  @ApiOperation({
    summary:
      'Preview the bash that installs only the Nixpacks CLI on an already-provisioned host (no Docker/Swarm rerun)',
  })
  getNixpacksInstallScript() {
    return this.remoteServerProvisionService.getNixpacksOnlyInstallScriptPreview();
  }

  @Post(':id/provision')
  @ApiOperation({
    summary:
      'Queue SSH provision on this host (install Docker, Swarm, weehawk overlay). Nixpacks is not part of this script — use POST :id/nixpacks-install separately. Processed by provision-worker.',
  })
  enqueueProvision(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServerProvisionService.enqueueProvision(
        resolvedId,
        this.uid(req),
      ),
    );
  }

  @Post(':id/docker-purge')
  @ApiOperation({
    summary:
      'Queue full Docker removal on this host (apt purge, delete /var/lib/docker). For conflict cleanup; processed by provision-worker.',
  })
  enqueueDockerPurge(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServerProvisionService.enqueueDockerPurge(
        resolvedId,
        this.uid(req),
      ),
    );
  }

  @Post(':id/nixpacks-install')
  @ApiOperation({
    summary:
      'Queue Nixpacks CLI install only over SSH (host already provisioned). Same worker as Install; poll provision-jobs.',
  })
  enqueueNixpacksInstall(
    @Param('id') id: string,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServerProvisionService.enqueueNixpacksInstall(
        resolvedId,
        this.uid(req),
      ),
    );
  }

  @Post('generate-keypair')
  @ApiOperation({
    summary:
      'Generate Ed25519 SSH key pair (OpenSSH format); add public key to remote authorized_keys',
  })
  generateKeypair() {
    return this.remoteServersService.generateSshKeyPair();
  }

  @Get(':id/console/containers/paged')
  @ApiOperation({
    summary: 'Remote WeeDocker: paginated containers (Dockerode/SSH)',
  })
  async consoleContainersPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleContainersPaged(
      rid,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Get(':id/console/containers/:containerId/logs')
  @ApiOperation({ summary: 'Remote WeeDocker: container logs' })
  async consoleContainerLogs(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Param('containerId') containerId: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleContainerLogs(
      rid,
      this.uid(req),
      containerId,
      tail,
    );
  }

  @Delete(':id/console/containers/:containerId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove container' })
  async consoleRemoveContainer(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Param('containerId') containerId: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleRemoveContainer(
      rid,
      this.uid(req),
      containerId,
      force,
    );
  }

  @Get(':id/console/images/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated images' })
  async consoleImagesPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleImagesPaged(
      rid,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/images')
  @ApiOperation({ summary: 'Remote WeeDocker: remove image by ref' })
  async consoleRemoveImage(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Query('ref') ref: string,
    @Query('force') forceRaw?: string,
  ) {
    const rid = await this.rid(id, req);
    const force =
      forceRaw === 'true' ||
      forceRaw === '1' ||
      String(forceRaw).toLowerCase() === 'yes';
    return this.remoteServersService.remoteConsoleRemoveImage(
      rid,
      this.uid(req),
      decodeURIComponent(ref ?? ''),
      force,
    );
  }

  @Get(':id/console/volumes/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated volumes' })
  async consoleVolumesPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleVolumesPaged(
      rid,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/volumes/:name')
  @ApiOperation({ summary: 'Remote WeeDocker: remove volume' })
  async consoleRemoveVolume(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Param('name') name: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleRemoveVolume(
      rid,
      this.uid(req),
      name,
      force,
    );
  }

  @Get(':id/console/networks/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated networks' })
  async consoleNetworksPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleNetworksPaged(
      rid,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/networks/:networkId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove network' })
  async consoleRemoveNetwork(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Param('networkId') networkId: string,
  ) {
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleRemoveNetwork(
      rid,
      this.uid(req),
      networkId,
    );
  }

  @Get(':id/console/services/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated swarm services' })
  async consoleServicesPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleServicesPaged(
      rid,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Get(':id/console/services/:serviceId/logs')
  @ApiOperation({ summary: 'Remote WeeDocker: service logs' })
  async consoleServiceLogs(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleServiceLogs(
      rid,
      this.uid(req),
      serviceId,
      tail,
    );
  }

  @Delete(':id/console/services/:serviceId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove swarm service' })
  async consoleRemoveService(
    @Req() req: { user?: { userId: number } },
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    const rid = await this.rid(id, req);
    return this.remoteServersService.remoteConsoleRemoveService(
      rid,
      this.uid(req),
      serviceId,
      force,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one remote server' })
  getOne(@Param('id') id: string, @Req() req: { user?: { userId: number } }) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServersService.findOne(resolvedId, this.uid(req)),
    );
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Create remote server (privateKey PEM stored encrypted in DB)',
  })
  create(
    @Body() dto: CreateRemoteServerDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.create(dto, this.uid(req));
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Update remote server' })
  patch(
    @Param('id') id: string,
    @Body() dto: UpdateRemoteServerDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServersService.update(resolvedId, dto, this.uid(req)),
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete remote server (only if no service uses it)',
  })
  remove(@Param('id') id: string, @Req() req: { user?: { userId: number } }) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServersService.remove(resolvedId, this.uid(req)),
    );
  }

  @Post(':id/test')
  @ApiOperation({
    summary:
      'Test SSH + remote Docker (Dockerode over ssh2, like Dokploy — no local `docker`/`ssh` CLI for this check)',
  })
  test(@Param('id') id: string, @Req() req: { user?: { userId: number } }) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServersService.testConnection(resolvedId, this.uid(req)),
    );
  }

  @Post(':id/test-ssh')
  @ApiOperation({
    summary:
      'Test SSH only (ssh2 shell echo + uname — no Dockerode / remote Docker API)',
  })
  testSsh(@Param('id') id: string, @Req() req: { user?: { userId: number } }) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServersService.testSshOnly(resolvedId, this.uid(req)),
    );
  }

  @Post(':id/terminal')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Run an SSH command on remote server and return output',
  })
  terminal(
    @Param('id') id: string,
    @Body() dto: RunRemoteTerminalDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.rid(id, req).then((resolvedId) =>
      this.remoteServersService.runTerminalCommand(
        resolvedId,
        this.uid(req),
        dto.command,
      ),
    );
  }
}
