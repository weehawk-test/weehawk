import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationLark } from '../entities/notification-lark.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { postJson, readString } from './http-utils';

@Injectable()
export class LarkProvider implements NotificationProvider {
  readonly type = NotificationChannelType.LARK;

  constructor(
    @InjectRepository(NotificationLark)
    private readonly repo: Repository<NotificationLark>,
  ) {}

  async saveConfig(channelId: string, config: Record<string, unknown>): Promise<void> {
    await this.repo.save(
      this.repo.create({
        channelId,
        webhookUrl: readString(config, 'webhookUrl'),
        secret: readString(config, 'secret') || null,
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const webhookUrl = row?.webhookUrl?.trim() ?? '';
    return {
      credentialPreview: webhookUrl ? `webhook•••${webhookUrl.slice(-10)}` : 'not set',
      targetPreview: 'lark',
    };
  }

  async send(channelId: string, _channelName: string, message: string): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    const webhookUrl = row?.webhookUrl?.trim() ?? '';
    if (!webhookUrl) return { ok: false, description: 'Missing Lark webhook URL' };
    return postJson(webhookUrl, {
      msg_type: 'text',
      content: { text: message },
    });
  }
}

