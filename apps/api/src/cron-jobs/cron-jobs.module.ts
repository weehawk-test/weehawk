import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutorModule } from '../executor/executor.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { CronJobsController } from './cron-jobs.controller';
import { CronJobsService } from './cron-jobs.service';
import { CronJob } from './entities/cron-job.entity';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CronJob, OrganizationMembership]),
    ExecutorModule,
    NotificationsModule,
    OrganizationsModule,
    RemoteServersModule,
    OrgRealtimeModule,
  ],
  controllers: [CronJobsController],
  providers: [CronJobsService],
  exports: [CronJobsService],
})
export class CronJobsModule {}
