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
export class MicrosoftTeamsProvider implements NotificationProvider {
  readonly type = NotificationChannelType.MICROSOFT_TEAMS;

  normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    return {
      webhookUrl: readString(config, 'webhookUrl'),
    };
  }

  async preview(channel: NotificationChannel): Promise<ChannelPreview> {
    const cfg = channelConfigRecord(channel);
    const webhookUrl = readString(cfg, 'webhookUrl');
    return {
      credentialPreview: webhookUrl
        ? `webhook•••${webhookUrl.slice(-10)}`
        : 'not set',
      targetPreview: 'teams',
    };
  }

  async send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    const cfg = channelConfigRecord(channel);
    const webhookUrl = readString(cfg, 'webhookUrl');
    if (!webhookUrl) {
      return { ok: false, description: 'Missing Teams webhook URL' };
    }
    return postJson(webhookUrl, { text: notificationPlainText(notification) });
  }
}
