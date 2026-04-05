import { NotificationChannel } from '../entities/notification-channel.entity';

export function channelConfigRecord(
  channel: NotificationChannel,
): Record<string, unknown> {
  const c = channel.config;
  if (c == null) return {};
  return typeof c === 'object' && !Array.isArray(c)
    ? (c as Record<string, unknown>)
    : {};
}
