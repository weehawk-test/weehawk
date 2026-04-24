import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview } from './provider.types';
import { readString } from './http-utils';

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
}
