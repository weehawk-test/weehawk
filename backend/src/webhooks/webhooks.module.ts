import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServicesModule } from '../services/services.module';
import { Webhook } from './entities/webhook.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksTriggerController } from './webhooks-trigger.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook]),
    ServicesModule,
    NotificationsModule,
  ],
  controllers: [WebhooksController, WebhooksTriggerController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
