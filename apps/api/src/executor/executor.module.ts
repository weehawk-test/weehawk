import { Module, forwardRef } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { RegistryModule } from '../registry/registry.module';
import { AuthModule } from '../auth/auth.module';
import { ExecutorService } from './executor.service';
import { ServiceTerminalGateway } from './service-terminal.gateway';

/**
 * Deployment / Docker execution (stack deploy, compose, builds, webhooks, backups).
 * Depends on {@link ServicesService} via forwardRef (circular with {@link ServicesModule}).
 */
@Module({
  imports: [
    forwardRef(() => ServicesModule),
    RemoteServersModule,
    RegistryModule,
    AuthModule,
  ],
  providers: [ExecutorService, ServiceTerminalGateway],
  exports: [ExecutorService],
})
export class ExecutorModule {}
