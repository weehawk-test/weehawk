import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RemoteServer } from './entities/remote-server.entity';
import { RemoteServerProvisionJob } from './entities/remote-server-provision-job.entity';
import { RemoteServersController } from './remote-servers.controller';
import { RemoteServersService } from './remote-servers.service';
import { RemoteServerProvisionService } from './remote-server-provision.service';
import { RemoteTerminalGateway } from './remote-terminal.gateway';
import { LocalTerminalGateway } from './local-terminal.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([RemoteServer, RemoteServerProvisionJob]),
    AuthModule,
  ],
  controllers: [RemoteServersController],
  providers: [
    RemoteServersService,
    RemoteServerProvisionService,
    RemoteTerminalGateway,
    LocalTerminalGateway,
  ],
  exports: [RemoteServersService, RemoteServerProvisionService],
})
export class RemoteServersModule {}
