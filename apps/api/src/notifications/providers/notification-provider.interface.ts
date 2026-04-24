import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { Notification } from '../entities/notification.entity';
import { ChannelPreview, ProviderSendResult } from './provider.types';

export interface NotificationProvider {
  readonly type: NotificationChannelType;

  /** Normalize and persist-safe shape for `NotificationChannel.config` (encrypted at rest in DB). */
  normalizeConfig(config: Record<string, unknown>): Record<string, unknown>;

  preview(channel: NotificationChannel): Promise<ChannelPreview>;

  send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult>;
}
