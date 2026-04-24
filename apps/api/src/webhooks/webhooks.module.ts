import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { ServicesModule } from '../services/services.module';
import { Webhook } from './entities/webhook.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksTriggerController } from './webhooks-trigger.controller';
import { WebhooksService } from './webhooks.service';
import { PublicWebhookHostGuard } from './public-webhook-host.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook]),
    forwardRef(() => ServicesModule),
    RemoteServersModule,
    NotificationsModule,
  ],
  controllers: [WebhooksController, WebhooksTriggerController],
  providers: [WebhooksService, PublicWebhookHostGuard],
  exports: [WebhooksService],
})
export class WebhooksModule {}
