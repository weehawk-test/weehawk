import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NotificationLog } from './entities/notification-log.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationTelegram } from './entities/notification-telegram.entity';
import { NotificationEmail } from './entities/notification-email.entity';
import { NotificationDiscord } from './entities/notification-discord.entity';
import { NotificationLark } from './entities/notification-lark.entity';
import { NotificationMicrosoftTeams } from './entities/notification-microsoft-teams.entity';
import { NotificationResend } from './entities/notification-resend.entity';
import { NotificationGotify } from './entities/notification-gotify.entity';
import { NotificationNtfy } from './entities/notification-ntfy.entity';
import { NotificationPushover } from './entities/notification-pushover.entity';
import { NotificationStack } from './entities/notification-stack.entity';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { TelegramProvider } from './providers/telegram.provider';
import { EmailProvider } from './providers/email.provider';
import { DiscordProvider } from './providers/discord.provider';
import { LarkProvider } from './providers/lark.provider';
import { MicrosoftTeamsProvider } from './providers/microsoft-teams.provider';
import { ResendProvider } from './providers/resend.provider';
import { GotifyProvider } from './providers/gotify.provider';
import { NtfyProvider } from './providers/ntfy.provider';
import { PushoverProvider } from './providers/pushover.provider';
import { StackProvider } from './providers/stack.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationChannel,
      NotificationLog,
      NotificationTelegram,
      NotificationEmail,
      NotificationDiscord,
      NotificationLark,
      NotificationMicrosoftTeams,
      NotificationResend,
      NotificationGotify,
      NotificationNtfy,
      NotificationPushover,
      NotificationStack,
    ]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    TelegramProvider,
    EmailProvider,
    DiscordProvider,
    LarkProvider,
    MicrosoftTeamsProvider,
    ResendProvider,
    GotifyProvider,
    NtfyProvider,
    PushoverProvider,
    StackProvider,
    {
      provide: ProviderRegistryService,
      useFactory: (
        telegram: TelegramProvider,
        email: EmailProvider,
        discord: DiscordProvider,
        lark: LarkProvider,
        teams: MicrosoftTeamsProvider,
        resend: ResendProvider,
        gotify: GotifyProvider,
        ntfy: NtfyProvider,
        pushover: PushoverProvider,
        stack: StackProvider,
      ) =>
        new ProviderRegistryService([
          telegram,
          email,
          discord,
          lark,
          teams,
          resend,
          gotify,
          ntfy,
          pushover,
          stack,
        ]),
      inject: [
        TelegramProvider,
        EmailProvider,
        DiscordProvider,
        LarkProvider,
        MicrosoftTeamsProvider,
        ResendProvider,
        GotifyProvider,
        NtfyProvider,
        PushoverProvider,
        StackProvider,
      ],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
