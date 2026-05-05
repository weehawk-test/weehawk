import { Module } from '@nestjs/common';
import { DockerSecretsController } from './dockersecrets.controller';
import { DockerSecretsService } from './dockersecrets.service';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';

@Module({
  imports: [RemoteServersModule, OrgRealtimeModule],
  controllers: [DockerSecretsController],
  providers: [DockerSecretsService],
  exports: [DockerSecretsService],
})
export class DockersecretsModule {}
