import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview } from './provider.types';
import { readString } from './http-utils';

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
}
