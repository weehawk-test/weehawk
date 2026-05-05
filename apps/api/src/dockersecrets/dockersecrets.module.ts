import { Module } from '@nestjs/common';
import { DockerSecretsController } from './dockersecrets.controller';
import { DockerSecretsService } from './dockersecrets.service';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [RemoteServersModule, OrgRealtimeModule, OrganizationsModule],
  controllers: [DockerSecretsController],
  providers: [DockerSecretsService],
  exports: [DockerSecretsService],
})
export class DockersecretsModule {}
