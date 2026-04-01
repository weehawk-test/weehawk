import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationGotify } from '../entities/notification-gotify.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { postJson, readString } from './http-utils';

@Injectable()
export class GotifyProvider implements NotificationProvider {
  readonly type = NotificationChannelType.GOTIFY;

  constructor(
    @InjectRepository(NotificationGotify)
    private readonly repo: Repository<NotificationGotify>,
  ) {}

  async saveConfig(
    channelId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const priority = Number.parseInt(readString(config, 'priority') || '5', 10);
    await this.repo.save(
      this.repo.create({
        channelId,
        serverUrl: readString(config, 'serverUrl'),
        appToken: readString(config, 'appToken'),
        priority: Number.isFinite(priority) ? priority : 5,
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const serverUrl = row?.serverUrl?.trim() ?? '';
    return {
      credentialPreview: serverUrl
        ? `server•••${serverUrl.slice(-10)}`
        : 'not set',
      targetPreview: 'gotify',
    };
  }

  async send(
    channelId: string,
    channelName: string,
    message: string,
  ): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    if (!row) return { ok: false, description: 'Missing Gotify configuration' };
    const serverUrl = row.serverUrl.trim();
    const appToken = row.appToken.trim();
    if (!serverUrl || !appToken)
      return { ok: false, description: 'Missing Gotify server/app token' };
    const url = `${serverUrl.replace(/\/+$/, '')}/message?token=${encodeURIComponent(appToken)}`;
    return postJson(url, {
      title: channelName,
      message,
      priority: row.priority ?? 5,
    });
  }
}
