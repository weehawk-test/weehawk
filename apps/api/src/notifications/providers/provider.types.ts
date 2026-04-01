import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';

export type ProviderResult = { ok: true } | { ok: false; description: string };

export type ChannelPreview = {
  credentialPreview: string;
  targetPreview: string;
};

export type ProviderContext = {
  channel: NotificationChannel;
  type: NotificationChannelType;
};
