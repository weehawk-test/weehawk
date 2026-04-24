import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview } from './provider.types';
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
}
