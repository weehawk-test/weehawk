import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { Notification } from '../entities/notification.entity';
import { notificationPlainText } from '../notification-format';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderSendResult } from './provider.types';
import { postFormUrlEncoded, readString } from './http-utils';

@Injectable()
export class PushoverProvider implements NotificationProvider {
  readonly type = NotificationChannelType.PUSHOVER;

  normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    return {
      appToken: readString(config, 'appToken'),
      userKey: readString(config, 'userKey'),
      device: readString(config, 'device') || null,
    };
  }

  async preview(channel: NotificationChannel): Promise<ChannelPreview> {
    const cfg = channelConfigRecord(channel);
    const userKey = readString(cfg, 'userKey');
    return {
      credentialPreview: userKey ? `user•••${userKey.slice(-6)}` : 'not set',
      targetPreview: readString(cfg, 'device') || 'pushover',
    };
  }

  async send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    const cfg = channelConfigRecord(channel);
    const appToken = readString(cfg, 'appToken');
    const userKey = readString(cfg, 'userKey');
    const device = readString(cfg, 'device');
    if (!appToken || !userKey) {
      return { ok: false, description: 'Missing Pushover app token/user key' };
    }
    return postFormUrlEncoded('https://api.pushover.net/1/messages.json', {
      token: appToken,
      user: userKey,
      message: notificationPlainText(notification),
      title: notification.title.trim() || channel.name,
      ...(device ? { device } : {}),
    });
  }
}
