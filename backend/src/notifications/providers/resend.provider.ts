import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationResend } from '../entities/notification-resend.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { postJson, readString } from './http-utils';

@Injectable()
export class ResendProvider implements NotificationProvider {
  readonly type = NotificationChannelType.RESEND;

  constructor(
    @InjectRepository(NotificationResend)
    private readonly repo: Repository<NotificationResend>,
  ) {}

  async saveConfig(
    channelId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.repo.save(
      this.repo.create({
        channelId,
        apiKey: readString(config, 'apiKey'),
        fromAddress: readString(config, 'fromAddress'),
        toAddress: readString(config, 'toAddress'),
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const apiKey = row?.apiKey?.trim() ?? '';
    const toAddress = row?.toAddress?.trim() ?? '';
    return {
      credentialPreview: apiKey ? `key•••${apiKey.slice(-6)}` : 'not set',
      targetPreview: toAddress || 'resend',
    };
  }

  async send(
    channelId: string,
    channelName: string,
    message: string,
  ): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    if (!row) return { ok: false, description: 'Missing Resend configuration' };
    const apiKey = row.apiKey.trim();
    const fromAddress = row.fromAddress.trim();
    const toAddress = row.toAddress.trim();
    if (!apiKey || !fromAddress || !toAddress) {
      return { ok: false, description: 'Missing Resend API key/from/to' };
    }
    return postJson(
      'https://api.resend.com/emails',
      {
        from: fromAddress,
        to: [toAddress],
        subject: `Weehawk Notification - ${channelName}`,
        text: message,
      },
      { Authorization: `Bearer ${apiKey}` },
    );
  }
}
