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

@Module({
  imports: [
    TypeOrmModule.forFeature([CronJob, OrganizationMembership]),
    ExecutorModule,
    NotificationsModule,
    OrganizationsModule,
    RemoteServersModule,
  ],
  controllers: [CronJobsController],
  providers: [CronJobsService],
  exports: [CronJobsService],
})
export class CronJobsModule {}
