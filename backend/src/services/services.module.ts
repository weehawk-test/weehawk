import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { Service } from './entities/service.entity';
import { ProjectsModule } from 'src/projects/projects.module';
import { ExecutorService } from './ExecutorService';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service]), 
    ProjectsModule, 
  ],
  controllers: [ServicesController],
  providers: [ServicesService,ExecutorService],
  exports: [ServicesService],
})
export class ServicesModule {}