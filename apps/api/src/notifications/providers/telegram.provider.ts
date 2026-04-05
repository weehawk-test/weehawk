import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { Notification } from '../entities/notification.entity';
import { sendTelegramMessage } from '../telegram-api';
import { notificationPlainText } from '../notification-format';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderSendResult } from './provider.types';
import { readString } from './http-utils';

@Injectable()
export class TelegramProvider implements NotificationProvider {
  readonly type = NotificationChannelType.TELEGRAM;

  normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    return {
      token: readString(config, 'token'),
      target: readString(config, 'target'),
    };
  }

  async preview(channel: NotificationChannel): Promise<ChannelPreview> {
    const cfg = channelConfigRecord(channel);
    const token = readString(cfg, 'token');
    const target = readString(cfg, 'target');
    return {
      credentialPreview: token ? `token•••${token.slice(-6)}` : 'not set',
      targetPreview: target || 'not set',
    };
  }

  async send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    const cfg = channelConfigRecord(channel);
    const token = readString(cfg, 'token');
    const target = readString(cfg, 'target');
    if (!token || !target) {
      return { ok: false, description: 'Missing Telegram token/target' };
    }
    const text = notificationPlainText(notification);
    return sendTelegramMessage(token, target, text);
  }
}
