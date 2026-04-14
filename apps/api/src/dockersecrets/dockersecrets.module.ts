import { Module } from '@nestjs/common';
import { DockerSecretsController } from './dockersecrets.controller';
import { DockerSecretsService } from './dockersecrets.service';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';

@Module({
  imports: [RemoteServersModule],
  controllers: [DockerSecretsController],
  providers: [DockerSecretsService],
  exports: [DockerSecretsService],
})
export class DockersecretsModule {}
