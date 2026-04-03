import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { Service } from './entities/service.entity';
import { ProjectsModule } from 'src/projects/projects.module';
import { ServiceTerminalGateway } from './service-terminal.gateway';
import { DatabaseGeneratorService } from './database-generator.service';
import { DockersecretsModule } from 'src/dockersecrets/dockersecrets.module';
import { ExecutorModule } from '../executor/executor.module';
import { DockerfileGeneratorModule } from '../dockerfile-generator/dockerfile-generator.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service]),
    ProjectsModule,
    DockersecretsModule,
    DockerfileGeneratorModule,
    forwardRef(() => ExecutorModule),
    S3Module,
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
