import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { S3Module } from '../s3/s3.module';
import { ServicesModule } from '../services/services.module';
import { CronJobsController } from './cron-jobs.controller';
import { CronJobsService } from './cron-jobs.service';
import { CronJob } from './entities/cron-job.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CronJob]),
    ServicesModule,
    NotificationsModule,
    S3Module,
  ],
  controllers: [CronJobsController],
  providers: [CronJobsService],
  exports: [CronJobsService],
})
export class CronJobsModule {}
