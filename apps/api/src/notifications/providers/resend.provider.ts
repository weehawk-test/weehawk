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
export class ResendProvider implements NotificationProvider {
  readonly type = NotificationChannelType.RESEND;

  normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    return {
      apiKey: readString(config, 'apiKey'),
      fromAddress: readString(config, 'fromAddress'),
      toAddress: readString(config, 'toAddress'),
    };
  }

  async preview(channel: NotificationChannel): Promise<ChannelPreview> {
    const cfg = channelConfigRecord(channel);
    const apiKey = readString(cfg, 'apiKey');
    const toAddress = readString(cfg, 'toAddress');
    return {
      credentialPreview: apiKey ? `key•••${apiKey.slice(-6)}` : 'not set',
      targetPreview: toAddress || 'resend',
    };
  }

  async send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    const cfg = channelConfigRecord(channel);
    const apiKey = readString(cfg, 'apiKey');
    const fromAddress = readString(cfg, 'fromAddress');
    const toAddress = readString(cfg, 'toAddress');
    if (!apiKey || !fromAddress || !toAddress) {
      return { ok: false, description: 'Missing Resend API key/from/to' };
    }
    return postJson(
      'https://api.resend.com/emails',
      {
        from: fromAddress,
        to: [toAddress],
        subject: notification.title.trim()
          ? `Weehawk — ${notification.title}`
          : `Weehawk Notification — ${channel.name}`,
        text: notificationPlainText(notification),
      },
      { Authorization: `Bearer ${apiKey}` },
    );
  }
}
