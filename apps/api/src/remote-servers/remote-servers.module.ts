import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RemoteServer } from './entities/remote-server.entity';
import { RemoteServerProvisionJob } from './entities/remote-server-provision-job.entity';
import { RemoteServersController } from './remote-servers.controller';
import { RemoteServersService } from './remote-servers.service';
import { RemoteServerProvisionService } from './remote-server-provision.service';
import { RemoteTerminalGateway } from './remote-terminal.gateway';
import { TraefikModule } from '../traefik/traefik.module';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RemoteServer,
      RemoteServerProvisionJob,
      OrganizationMembership,
    ]),
    TraefikModule,
    AuthModule,
    OrganizationsModule,
    OrgRealtimeModule,
  ],
  controllers: [RemoteServersController],
  providers: [
    RemoteServersService,
    RemoteServerProvisionService,
    RemoteTerminalGateway,
  ],
  exports: [RemoteServersService, RemoteServerProvisionService],
})
export class RemoteServersModule {}
