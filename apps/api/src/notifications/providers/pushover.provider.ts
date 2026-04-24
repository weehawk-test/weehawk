import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview } from './provider.types';
import { readString } from './http-utils';

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
}
