import { Module } from '@nestjs/common';
import { DockerService } from './docker.service';
import { DockerController } from './docker.controller';
import { DockerMonitorGateway } from './docker-monitor.gateway';
import { DockersecretsModule } from '../dockersecrets/dockersecrets.module';

@Module({
  imports: [DockersecretsModule],
  controllers: [DockerController],
  providers: [DockerService, DockerMonitorGateway],
})
export class DockerModule {}
