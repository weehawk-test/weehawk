import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { S3Module } from '../s3/s3.module';
import { ServicesModule } from '../services/services.module';
import { Webhook } from './entities/webhook.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksTriggerController } from './webhooks-trigger.controller';
import { WebhooksService } from './webhooks.service';
import { PublicWebhookHostGuard } from './public-webhook-host.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook]),
    ServicesModule,
    RemoteServersModule,
    NotificationsModule,
    S3Module,
  ],
  controllers: [WebhooksController, WebhooksTriggerController],
  providers: [WebhooksService, PublicWebhookHostGuard],
})
export class WebhooksModule {}
