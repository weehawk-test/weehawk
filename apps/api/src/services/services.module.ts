import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { RemoteImportBackupInterceptor } from './remote-import-backup.interceptor';
import { Service } from './entities/service.entity';
import { RemoteServer } from '../remote-servers/entities/remote-server.entity';
import { ProjectsModule } from 'src/projects/projects.module';
import { DatabaseGeneratorService } from './database-generator.service';
import { ExecutorModule } from '../executor/executor.module';
import { S3Module } from '../s3/s3.module';
import { GitModule } from '../git/git.module';
import { TraefikModule } from '../traefik/traefik.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service, RemoteServer]),
    ProjectsModule,
    forwardRef(() => ExecutorModule),
    forwardRef(() => WebhooksModule),
    RemoteServersModule,
    S3Module,
    GitModule,
    TraefikModule,
  ],
  controllers: [ServicesController],
  providers: [ServicesService, DatabaseGeneratorService, RemoteImportBackupInterceptor],
  exports: [
    ServicesService,
    DatabaseGeneratorService,
    ExecutorModule,
  ],
})
export class ServicesModule {}
