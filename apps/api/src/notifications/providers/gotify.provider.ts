import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview } from './provider.types';
import { readString } from './http-utils';

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
}
