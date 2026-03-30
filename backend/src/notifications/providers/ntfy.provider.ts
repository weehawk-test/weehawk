import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationNtfy } from '../entities/notification-ntfy.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { postJson, readString } from './http-utils';

@Injectable()
export class NtfyProvider implements NotificationProvider {
  readonly type = NotificationChannelType.NTFY;

  constructor(
    @InjectRepository(NotificationNtfy)
    private readonly repo: Repository<NotificationNtfy>,
  ) {}

  async saveConfig(channelId: string, config: Record<string, unknown>): Promise<void> {
    await this.repo.save(
      this.repo.create({
        channelId,
        serverUrl: readString(config, 'serverUrl'),
        topic: readString(config, 'topic'),
        token: readString(config, 'token') || null,
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const topic = row?.topic?.trim() ?? '';
    return {
      credentialPreview: 'ntfy',
      targetPreview: topic || 'topic',
    };
  }

  async send(channelId: string, channelName: string, message: string): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    if (!row) return { ok: false, description: 'Missing ntfy configuration' };
    const serverUrl = row.serverUrl.trim();
    const topic = row.topic.trim();
    const token = row.token?.trim() ?? '';
    if (!serverUrl || !topic) return { ok: false, description: 'Missing ntfy server/topic' };
    const url = `${serverUrl.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`;
    return postJson(
      url,
      { topic, message, title: channelName },
      token ? { Authorization: `Bearer ${token}` } : undefined,
    );
  }
}

