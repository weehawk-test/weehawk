import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationTelegram } from '../entities/notification-telegram.entity';
import { sendTelegramMessage } from '../telegram-api';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { readString } from './http-utils';

@Injectable()
export class TelegramProvider implements NotificationProvider {
  readonly type = NotificationChannelType.TELEGRAM;

  constructor(
    @InjectRepository(NotificationTelegram)
    private readonly repo: Repository<NotificationTelegram>,
  ) {}

  async saveConfig(channelId: string, config: Record<string, unknown>): Promise<void> {
    const token = readString(config, 'token');
    const target = readString(config, 'target');
    await this.repo.save(
      this.repo.create({
        channelId,
        token,
        target,
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const token = row?.token?.trim() ?? '';
    const target = row?.target?.trim() ?? '';
    return {
      credentialPreview: token ? `token•••${token.slice(-6)}` : 'not set',
      targetPreview: target || 'not set',
    };
  }

  async send(channelId: string, _channelName: string, message: string): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    const token = row?.token?.trim() ?? '';
    const target = row?.target?.trim() ?? '';
    if (!token || !target) {
      return { ok: false, description: 'Missing Telegram token/target' };
    }
    return sendTelegramMessage(token, target, message);
  }
}

