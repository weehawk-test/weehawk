import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { TelegramProvider } from './providers/telegram.provider';
import { EmailProvider } from './providers/email.provider';
import { SlackProvider } from './providers/slack.provider';
import { DiscordProvider } from './providers/discord.provider';
import { LarkProvider } from './providers/lark.provider';
import { MicrosoftTeamsProvider } from './providers/microsoft-teams.provider';
import { ResendProvider } from './providers/resend.provider';
import { GotifyProvider } from './providers/gotify.provider';
import { NtfyProvider } from './providers/ntfy.provider';
import { PushoverProvider } from './providers/pushover.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationChannel,
      Notification,
      NotificationDelivery,
    ]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    TelegramProvider,
    EmailProvider,
    SlackProvider,
    DiscordProvider,
    LarkProvider,
    MicrosoftTeamsProvider,
    ResendProvider,
    GotifyProvider,
    NtfyProvider,
    PushoverProvider,
    {
      provide: ProviderRegistryService,
      useFactory: (
        telegram: TelegramProvider,
        email: EmailProvider,
        slack: SlackProvider,
        discord: DiscordProvider,
        lark: LarkProvider,
        teams: MicrosoftTeamsProvider,
        resend: ResendProvider,
        gotify: GotifyProvider,
        ntfy: NtfyProvider,
        pushover: PushoverProvider,
      ) =>
        new ProviderRegistryService([
          telegram,
          email,
          slack,
          discord,
          lark,
          teams,
          resend,
          gotify,
          ntfy,
          pushover,
        ]),
      inject: [
        TelegramProvider,
        EmailProvider,
        SlackProvider,
        DiscordProvider,
        LarkProvider,
        MicrosoftTeamsProvider,
        ResendProvider,
        GotifyProvider,
        NtfyProvider,
        PushoverProvider,
      ],
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
