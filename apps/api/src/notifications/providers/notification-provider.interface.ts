import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { ChannelPreview, ProviderResult } from './provider.types';

export interface NotificationProvider {
  readonly type: NotificationChannelType;

  /** Persist provider-specific config for a channel. */
  saveConfig(channelId: string, config: Record<string, unknown>): Promise<void>;

  /** Return masked UI preview fields. */
  preview(channelId: string): Promise<ChannelPreview>;

  /** Send a message using stored config. */
  send(
    channelId: string,
    channelName: string,
    message: string,
  ): Promise<ProviderResult>;
}
