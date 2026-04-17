import './load-docker-secrets';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CronJobsService } from './cron-jobs/cron-jobs.service';

async function bootstrapCronWorker() {
  const logger = new Logger('CronWorker');
  const app = await NestFactory.createApplicationContext(AppModule);
  const cronJobsService = app.get(CronJobsService);

  logger.log('Cron worker started');

  // Run once at startup, then poll every 30 seconds.
  await cronJobsService.runDueCronJobs();
  const interval = setInterval(() => {
    void cronJobsService.runDueCronJobs();
  }, 30_000);

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down cron worker...`);
    clearInterval(interval);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrapCronWorker();
