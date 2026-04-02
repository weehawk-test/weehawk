import { Module, forwardRef } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { ExecutorService } from './executor.service';

/**
 * Deployment / Docker execution (stack deploy, compose, builds, webhooks, backups).
 * Depends on {@link ServicesService} via forwardRef (circular with {@link ServicesModule}).
 */
@Module({
  imports: [forwardRef(() => ServicesModule)],
  providers: [ExecutorService],
  exports: [ExecutorService],
})
export class ExecutorModule {}
