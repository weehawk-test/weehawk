import { Module } from '@nestjs/common';
import { DockerSecretsController } from './dockersecrets.controller';
import { DockerSecretsService } from './dockersecrets.service';

@Module({
  controllers: [DockerSecretsController],
  providers: [DockerSecretsService],
  exports: [DockerSecretsService],
})
export class DockersecretsModule {}
