import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationStack } from '../entities/notification-stack.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { postJson, readString } from './http-utils';

@Injectable()
export class StackProvider implements NotificationProvider {
  readonly type = NotificationChannelType.STACK;

  constructor(
    @InjectRepository(NotificationStack)
    private readonly repo: Repository<NotificationStack>,
  ) {}

  async saveConfig(
    channelId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.repo.save(
      this.repo.create({
        channelId,
        webhookUrl: readString(config, 'webhookUrl'),
        project: readString(config, 'project') || null,
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const webhookUrl = row?.webhookUrl?.trim() ?? '';
    return {
      credentialPreview: webhookUrl
        ? `webhook•••${webhookUrl.slice(-10)}`
        : 'not set',
      targetPreview: row?.project?.trim() || 'stack',
    };
  }

  async send(
    channelId: string,
    channelName: string,
    message: string,
  ): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    if (!row) return { ok: false, description: 'Missing Stack configuration' };
    const webhookUrl = row.webhookUrl.trim();
    const project = row.project?.trim() ?? '';
    if (!webhookUrl)
      return { ok: false, description: 'Missing Stack webhook URL' };
    return postJson(webhookUrl, {
      message,
      channel: channelName,
      project: project || undefined,
    });
  }
}
