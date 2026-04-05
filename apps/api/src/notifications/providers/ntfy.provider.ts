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
export class NtfyProvider implements NotificationProvider {
  readonly type = NotificationChannelType.NTFY;

  normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    return {
      serverUrl: readString(config, 'serverUrl'),
      topic: readString(config, 'topic'),
      token: readString(config, 'token') || null,
    };
  }

  async preview(channel: NotificationChannel): Promise<ChannelPreview> {
    const cfg = channelConfigRecord(channel);
    const topic = readString(cfg, 'topic');
    return {
      credentialPreview: 'ntfy',
      targetPreview: topic || 'topic',
    };
  }

  async send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    const cfg = channelConfigRecord(channel);
    const serverUrl = readString(cfg, 'serverUrl');
    const topic = readString(cfg, 'topic');
    const token = readString(cfg, 'token');
    if (!serverUrl || !topic) {
      return { ok: false, description: 'Missing ntfy server/topic' };
    }
    const url = `${serverUrl.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`;
    const title = notification.title.trim() || channel.name;
    return postJson(
      url,
      {
        topic,
        message: notificationPlainText(notification),
        title,
      },
      token ? { Authorization: `Bearer ${token}` } : undefined,
    );
  }
}
