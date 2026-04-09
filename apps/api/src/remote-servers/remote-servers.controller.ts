import {
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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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

  private uid(_req?: unknown): number {
    return 1;
  }

  @Get()
  @ApiOperation({ summary: 'List SSH / Docker remote hosts' })
  list(@Req() req: { user?: { userId: number } }) {
    return this.remoteServersService.findAll(this.uid(req));
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
  getProvisionScript(@Query('role') role?: string) {
    const r = role === 'build' ? 'build' : 'deploy';
    return this.remoteServerProvisionService.getProvisionScriptPreview(r);
  }

  @Get('docker-purge-script')
  @ApiOperation({
    summary:
      'Preview the destructive bash that purges Docker (use when old/conflicting packages block install)',
  })
  getDockerPurgeScript() {
    return this.remoteServerProvisionService.getDockerPurgeScriptPreview();
  }

  @Post(':id/provision')
  @ApiOperation({
    summary:
      'Queue SSH provision on this host (install Docker, Swarm, weehawk overlay). Processed by provision-worker.',
  })
  enqueueProvision(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServerProvisionService.enqueueProvision(id, this.uid(req));
  }

  @Post(':id/docker-purge')
  @ApiOperation({
    summary:
      'Queue full Docker removal on this host (apt purge, delete /var/lib/docker). For conflict cleanup; processed by provision-worker.',
  })
  enqueueDockerPurge(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServerProvisionService.enqueueDockerPurge(id, this.uid(req));
  }

  @Post('generate-keypair')
  @ApiOperation({
    summary: 'Generate Ed25519 SSH key pair (OpenSSH format); add public key to remote authorized_keys',
  })
  generateKeypair() {
    return this.remoteServersService.generateSshKeyPair();
  }

  @Get(':id/console/containers/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated containers (Dockerode/SSH)' })
  consoleContainersPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleContainersPaged(
      id,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Get(':id/console/containers/:containerId/logs')
  @ApiOperation({ summary: 'Remote WeeDocker: container logs' })
  consoleContainerLogs(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Param('containerId') containerId: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    return this.remoteServersService.remoteConsoleContainerLogs(
      id,
      this.uid(req),
      containerId,
      tail,
    );
  }

  @Delete(':id/console/containers/:containerId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove container' })
  consoleRemoveContainer(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Param('containerId') containerId: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return this.remoteServersService.remoteConsoleRemoveContainer(
      id,
      this.uid(req),
      containerId,
      force,
    );
  }

  @Get(':id/console/images/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated images' })
  consoleImagesPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleImagesPaged(
      id,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/images')
  @ApiOperation({ summary: 'Remote WeeDocker: remove image by ref' })
  consoleRemoveImage(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('ref') ref: string,
  ) {
    return this.remoteServersService.remoteConsoleRemoveImage(
      id,
      this.uid(req),
      decodeURIComponent(ref ?? ''),
    );
  }

  @Get(':id/console/volumes/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated volumes' })
  consoleVolumesPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleVolumesPaged(
      id,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/volumes/:name')
  @ApiOperation({ summary: 'Remote WeeDocker: remove volume' })
  consoleRemoveVolume(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Param('name') name: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return this.remoteServersService.remoteConsoleRemoveVolume(
      id,
      this.uid(req),
      name,
      force,
    );
  }

  @Get(':id/console/networks/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated networks' })
  consoleNetworksPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleNetworksPaged(
      id,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/networks/:networkId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove network' })
  consoleRemoveNetwork(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Param('networkId') networkId: string,
  ) {
    return this.remoteServersService.remoteConsoleRemoveNetwork(
      id,
      this.uid(req),
      networkId,
    );
  }

  @Get(':id/console/services/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated swarm services' })
  consoleServicesPaged(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleServicesPaged(
      id,
      this.uid(req),
      page,
      pageSize,
      q ?? '',
    );
  }

  @Get(':id/console/services/:serviceId/logs')
  @ApiOperation({ summary: 'Remote WeeDocker: service logs' })
  consoleServiceLogs(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Param('serviceId') serviceId: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    return this.remoteServersService.remoteConsoleServiceLogs(
      id,
      this.uid(req),
      serviceId,
      tail,
    );
  }

  @Delete(':id/console/services/:serviceId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove swarm service' })
  consoleRemoveService(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Param('serviceId') serviceId: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return this.remoteServersService.remoteConsoleRemoveService(
      id,
      this.uid(req),
      serviceId,
      force,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one remote server' })
  getOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.findOne(id, this.uid(req));
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Create remote server (privateKey PEM stored encrypted in DB)' })
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
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRemoteServerDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.update(id, dto, this.uid(req));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete remote server (only if no service uses it)' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.remove(id, this.uid(req));
  }

  @Post(':id/test')
  @ApiOperation({
    summary:
      'Test SSH + remote Docker (Dockerode over ssh2, like Dokploy — no local `docker`/`ssh` CLI for this check)',
  })
  test(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.testConnection(id, this.uid(req));
  }

  @Post(':id/test-ssh')
  @ApiOperation({
    summary:
      'Test SSH only (ssh2 shell echo + uname — no Dockerode / remote Docker API)',
  })
  testSsh(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.testSshOnly(id, this.uid(req));
  }

  @Post(':id/terminal')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Run an SSH command on remote server and return output' })
  terminal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RunRemoteTerminalDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.remoteServersService.runTerminalCommand(id, this.uid(req), dto.command);
  }
}
