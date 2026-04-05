import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { Notification } from '../entities/notification.entity';
import { notificationPlainText } from '../notification-format';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderSendResult } from './provider.types';
import { postJson, readString } from './http-utils';

@Injectable()
export class GotifyProvider implements NotificationProvider {
  readonly type = NotificationChannelType.GOTIFY;

  normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const priority = Number.parseInt(readString(config, 'priority') || '5', 10);
    return {
      serverUrl: readString(config, 'serverUrl'),
      appToken: readString(config, 'appToken'),
      priority: Number.isFinite(priority) ? priority : 5,
    };
  }

  async preview(channel: NotificationChannel): Promise<ChannelPreview> {
    const cfg = channelConfigRecord(channel);
    const serverUrl = readString(cfg, 'serverUrl');
    return {
      credentialPreview: serverUrl
        ? `server•••${serverUrl.slice(-10)}`
        : 'not set',
      targetPreview: 'gotify',
    };
  }

  async send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    const cfg = channelConfigRecord(channel);
    const serverUrl = readString(cfg, 'serverUrl');
    const appToken = readString(cfg, 'appToken');
    const priority = Number(cfg['priority']);
    if (!serverUrl || !appToken) {
      return { ok: false, description: 'Missing Gotify server/app token' };
    }
    const url = `${serverUrl.replace(/\/+$/, '')}/message?token=${encodeURIComponent(appToken)}`;
    return postJson(url, {
      title: notification.title.trim() || channel.name,
      message: notificationPlainText(notification),
      priority: Number.isFinite(priority) ? priority : 5,
    });
  }
}
