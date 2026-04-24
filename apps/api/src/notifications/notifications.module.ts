import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { TelegramProvider } from './providers/telegram.provider';
import { SlackProvider } from './providers/slack.provider';
import { DiscordProvider } from './providers/discord.provider';
import { LarkProvider } from './providers/lark.provider';
import { MicrosoftTeamsProvider } from './providers/microsoft-teams.provider';
import { GotifyProvider } from './providers/gotify.provider';
import { NtfyProvider } from './providers/ntfy.provider';
import { PushoverProvider } from './providers/pushover.provider';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationChannel]),
    RemoteServersModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    TelegramProvider,
    SlackProvider,
    DiscordProvider,
    LarkProvider,
    MicrosoftTeamsProvider,
    GotifyProvider,
    NtfyProvider,
    PushoverProvider,
    {
      provide: ProviderRegistryService,
      useFactory: (
        telegram: TelegramProvider,
        slack: SlackProvider,
        discord: DiscordProvider,
        lark: LarkProvider,
        teams: MicrosoftTeamsProvider,
        gotify: GotifyProvider,
        ntfy: NtfyProvider,
        pushover: PushoverProvider,
      ) =>
        new ProviderRegistryService([
          telegram,
          slack,
          discord,
          lark,
          teams,
          gotify,
          ntfy,
          pushover,
        ]),
      inject: [
        TelegramProvider,
        SlackProvider,
        DiscordProvider,
        LarkProvider,
        MicrosoftTeamsProvider,
        GotifyProvider,
        NtfyProvider,
        PushoverProvider,
      ],
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
