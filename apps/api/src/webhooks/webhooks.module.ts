import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { ServicesModule } from '../services/services.module';
import { Webhook } from './entities/webhook.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksTriggerController } from './webhooks-trigger.controller';
import { WebhooksService } from './webhooks.service';
import { PublicWebhookHostGuard } from './public-webhook-host.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook, OrganizationMembership]),
    forwardRef(() => ServicesModule),
    OrganizationsModule,
    RemoteServersModule,
    NotificationsModule,
  ],
  controllers: [WebhooksController, WebhooksTriggerController],
  providers: [WebhooksService, PublicWebhookHostGuard],
  exports: [WebhooksService],
})
export class WebhooksModule {}
