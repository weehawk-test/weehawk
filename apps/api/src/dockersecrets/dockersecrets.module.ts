import { Module } from '@nestjs/common';
import { DockerSecretsController } from './dockersecrets.controller';
import { DockerSecretsService } from './dockersecrets.service';
import { CloudEditionLocalDockerGuard } from '../common/guards/cloud-edition-local-docker.guard';

@Module({
  controllers: [DockerSecretsController],
  providers: [DockerSecretsService, CloudEditionLocalDockerGuard],
  exports: [DockerSecretsService],
})
export class DockersecretsModule {}
