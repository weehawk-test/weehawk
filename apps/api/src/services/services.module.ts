import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { Service } from './entities/service.entity';
import { RemoteServer } from '../remote-servers/entities/remote-server.entity';
import { ProjectsModule } from 'src/projects/projects.module';
import { ServiceTerminalGateway } from './service-terminal.gateway';
import { DatabaseGeneratorService } from './database-generator.service';
import { DockersecretsModule } from 'src/dockersecrets/dockersecrets.module';
import { ExecutorModule } from '../executor/executor.module';
import { DockerfileGeneratorModule } from '../dockerfile-generator/dockerfile-generator.module';
import { S3Module } from '../s3/s3.module';
import { GitModule } from '../git/git.module';
import { TraefikModule } from '../traefik/traefik.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service, RemoteServer]),
    AuthModule,
    ProjectsModule,
    DockersecretsModule,
    DockerfileGeneratorModule,
    forwardRef(() => ExecutorModule),
    S3Module,
    GitModule,
    TraefikModule,
  ],
  controllers: [ServicesController],
  providers: [ServicesService, ServiceTerminalGateway, DatabaseGeneratorService],
  exports: [
    ServicesService,
    DatabaseGeneratorService,
    ExecutorModule,
  ],
})
export class ServicesModule {}
