import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { ChannelPreview } from './provider.types';

export interface NotificationProvider {
  readonly type: NotificationChannelType;

  /** Normalize and persist-safe shape for `NotificationChannel.config` (encrypted at rest in DB). */
  normalizeConfig(config: Record<string, unknown>): Record<string, unknown>;

  preview(channel: NotificationChannel): Promise<ChannelPreview>;
}
