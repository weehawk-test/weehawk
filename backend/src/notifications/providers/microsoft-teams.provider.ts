import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationMicrosoftTeams } from '../entities/notification-microsoft-teams.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { postJson, readString } from './http-utils';

@Injectable()
export class MicrosoftTeamsProvider implements NotificationProvider {
  readonly type = NotificationChannelType.MICROSOFT_TEAMS;

  constructor(
    @InjectRepository(NotificationMicrosoftTeams)
    private readonly repo: Repository<NotificationMicrosoftTeams>,
  ) {}

  async saveConfig(channelId: string, config: Record<string, unknown>): Promise<void> {
    await this.repo.save(
      this.repo.create({
        channelId,
        webhookUrl: readString(config, 'webhookUrl'),
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const webhookUrl = row?.webhookUrl?.trim() ?? '';
    return {
      credentialPreview: webhookUrl ? `webhook•••${webhookUrl.slice(-10)}` : 'not set',
      targetPreview: 'teams',
    };
  }

  async send(channelId: string, _channelName: string, message: string): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    const webhookUrl = row?.webhookUrl?.trim() ?? '';
    if (!webhookUrl) return { ok: false, description: 'Missing Teams webhook URL' };
    return postJson(webhookUrl, { text: message });
  }
}

