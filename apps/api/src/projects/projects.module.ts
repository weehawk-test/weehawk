import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { Project } from './entities/project.entity';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, OrganizationMembership]),
    OrganizationsModule,
    OrgRealtimeModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [TypeOrmModule, ProjectsService],
})
export class ProjectsModule {}
