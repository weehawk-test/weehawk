import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';

export type ProviderSendResult =
  | { ok: true; response?: string | Record<string, unknown> }
  | { ok: false; description: string; response?: string | Record<string, unknown> };

/** @deprecated Prefer ProviderSendResult; kept for HTTP helpers. */
export type ProviderResult = ProviderSendResult;

export type ChannelPreview = {
  credentialPreview: string;
  targetPreview: string;
};

export type ProviderContext = {
  channel: NotificationChannel;
  type: NotificationChannelType;
};
