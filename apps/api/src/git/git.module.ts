import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GitIntegrationSettings } from './entities/git-integration.entity';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GitIntegrationSettings]),
    OrganizationsModule,
    OrgRealtimeModule,
  ],
  controllers: [GitController],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
