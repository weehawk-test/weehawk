import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationPushover } from '../entities/notification-pushover.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { postFormUrlEncoded, readString } from './http-utils';

@Injectable()
export class PushoverProvider implements NotificationProvider {
  readonly type = NotificationChannelType.PUSHOVER;

  constructor(
    @InjectRepository(NotificationPushover)
    private readonly repo: Repository<NotificationPushover>,
  ) {}

  async saveConfig(
    channelId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.repo.save(
      this.repo.create({
        channelId,
        appToken: readString(config, 'appToken'),
        userKey: readString(config, 'userKey'),
        device: readString(config, 'device') || null,
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const userKey = row?.userKey?.trim() ?? '';
    return {
      credentialPreview: userKey ? `user•••${userKey.slice(-6)}` : 'not set',
      targetPreview: row?.device?.trim() || 'pushover',
    };
  }

  async send(
    channelId: string,
    channelName: string,
    message: string,
  ): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    if (!row)
      return { ok: false, description: 'Missing Pushover configuration' };
    const appToken = row.appToken.trim();
    const userKey = row.userKey.trim();
    const device = row.device?.trim() ?? '';
    if (!appToken || !userKey)
      return { ok: false, description: 'Missing Pushover app token/user key' };
    return postFormUrlEncoded('https://api.pushover.net/1/messages.json', {
      token: appToken,
      user: userKey,
      message,
      title: channelName,
      ...(device ? { device } : {}),
    });
  }
}
