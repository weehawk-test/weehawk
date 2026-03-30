import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { Service } from './entities/service.entity';
import { ProjectsModule } from 'src/projects/projects.module';
import { ExecutorService } from './ExecutorService';
import { ServiceTerminalGateway } from './service-terminal.gateway';
import { DatabaseGeneratorService } from './database-generator.service';

@Module({
  imports: [TypeOrmModule.forFeature([Service]), ProjectsModule],
  controllers: [ServicesController],
  providers: [
    ServicesService,
    ExecutorService,
    ServiceTerminalGateway,
    DatabaseGeneratorService,
  ],
  exports: [ServicesService, ExecutorService, DatabaseGeneratorService],
})
export class ServicesModule {}
