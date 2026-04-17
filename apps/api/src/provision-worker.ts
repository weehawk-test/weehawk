import './load-docker-secrets';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RemoteServerProvisionService } from './remote-servers/remote-server-provision.service';

const POLL_MS = 5_000;

async function bootstrapProvisionWorker() {
  const logger = new Logger('ProvisionWorker');
  const app = await NestFactory.createApplicationContext(AppModule);
  const provision = app.get(RemoteServerProvisionService);

  logger.log('Provision worker started (SSH: Docker + Swarm + weehawk overlay)');

  const tick = () => {
    void provision.processNextPendingJob().catch((e) => {
      logger.error(e instanceof Error ? e.message : String(e));
    });
  };

  tick();
  const interval = setInterval(tick, POLL_MS);

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down provision worker...`);
    clearInterval(interval);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrapProvisionWorker();
