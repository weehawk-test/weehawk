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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RemoteServersService } from './remote-servers.service';
import { CreateRemoteServerDto } from './dto/create-remote-server.dto';
import { UpdateRemoteServerDto } from './dto/update-remote-server.dto';

@ApiTags('Remote servers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/remote-servers')
export class RemoteServersController {
  constructor(private readonly remoteServersService: RemoteServersService) {}

  @Get()
  @ApiOperation({ summary: 'List SSH / Docker remote hosts' })
  list() {
    return this.remoteServersService.findAll();
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
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleContainersPaged(
      id,
      page,
      pageSize,
      q ?? '',
    );
  }

  @Get(':id/console/containers/:containerId/logs')
  @ApiOperation({ summary: 'Remote WeeDocker: container logs' })
  consoleContainerLogs(
    @Param('id', ParseIntPipe) id: number,
    @Param('containerId') containerId: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    return this.remoteServersService.remoteConsoleContainerLogs(
      id,
      containerId,
      tail,
    );
  }

  @Delete(':id/console/containers/:containerId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove container' })
  consoleRemoveContainer(
    @Param('id', ParseIntPipe) id: number,
    @Param('containerId') containerId: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return this.remoteServersService.remoteConsoleRemoveContainer(
      id,
      containerId,
      force,
    );
  }

  @Get(':id/console/images/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated images' })
  consoleImagesPaged(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleImagesPaged(
      id,
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/images')
  @ApiOperation({ summary: 'Remote WeeDocker: remove image by ref' })
  consoleRemoveImage(
    @Param('id', ParseIntPipe) id: number,
    @Query('ref') ref: string,
  ) {
    return this.remoteServersService.remoteConsoleRemoveImage(
      id,
      decodeURIComponent(ref ?? ''),
    );
  }

  @Get(':id/console/volumes/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated volumes' })
  consoleVolumesPaged(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleVolumesPaged(
      id,
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/volumes/:name')
  @ApiOperation({ summary: 'Remote WeeDocker: remove volume' })
  consoleRemoveVolume(
    @Param('id', ParseIntPipe) id: number,
    @Param('name') name: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return this.remoteServersService.remoteConsoleRemoveVolume(id, name, force);
  }

  @Get(':id/console/networks/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated networks' })
  consoleNetworksPaged(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleNetworksPaged(
      id,
      page,
      pageSize,
      q ?? '',
    );
  }

  @Delete(':id/console/networks/:networkId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove network' })
  consoleRemoveNetwork(
    @Param('id', ParseIntPipe) id: number,
    @Param('networkId') networkId: string,
  ) {
    return this.remoteServersService.remoteConsoleRemoveNetwork(id, networkId);
  }

  @Get(':id/console/services/paged')
  @ApiOperation({ summary: 'Remote WeeDocker: paginated swarm services' })
  consoleServicesPaged(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return this.remoteServersService.remoteConsoleServicesPaged(
      id,
      page,
      pageSize,
      q ?? '',
    );
  }

  @Get(':id/console/services/:serviceId/logs')
  @ApiOperation({ summary: 'Remote WeeDocker: service logs' })
  consoleServiceLogs(
    @Param('id', ParseIntPipe) id: number,
    @Param('serviceId') serviceId: string,
    @Query('tail', new DefaultValuePipe(500), ParseIntPipe) tail: number,
  ) {
    return this.remoteServersService.remoteConsoleServiceLogs(id, serviceId, tail);
  }

  @Delete(':id/console/services/:serviceId')
  @ApiOperation({ summary: 'Remote WeeDocker: remove swarm service' })
  consoleRemoveService(
    @Param('id', ParseIntPipe) id: number,
    @Param('serviceId') serviceId: string,
    @Query('force') forceStr?: string,
  ) {
    const force = (forceStr ?? '').toLowerCase() === 'true';
    return this.remoteServersService.remoteConsoleRemoveService(
      id,
      serviceId,
      force,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one remote server' })
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.remoteServersService.findOne(id);
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Create remote server (privateKey PEM stored encrypted in DB)' })
  create(@Body() dto: CreateRemoteServerDto) {
    return this.remoteServersService.create(dto);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Update remote server' })
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRemoteServerDto,
  ) {
    return this.remoteServersService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete remote server (only if no service uses it)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.remoteServersService.remove(id);
  }

  @Post(':id/test')
  @ApiOperation({
    summary:
      'Test SSH + remote Docker (Dockerode over ssh2, like Dokploy — no local `docker`/`ssh` CLI for this check)',
  })
  test(@Param('id', ParseIntPipe) id: number) {
    return this.remoteServersService.testConnection(id);
  }
}
