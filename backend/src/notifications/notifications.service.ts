import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NotificationLog } from './entities/notification-log.entity';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { sendTelegramMessage } from './telegram-api';

export const NOTIFICATION_TEST_MESSAGE = 'Hello this is weehawk';

export type NotificationChannelRow = {
  id: string;
  name: string;
  type: string;
  botToken: string;
  chatId: string;
  isActive: boolean;
  createdAt: string;
};

export type NotificationLogRow = {
  id: string;
  channelId: string | null;
  channelName: string;
  message: string;
  status: 'sent' | 'failed';
  sentAt: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationChannel)
    private readonly channelRepo: Repository<NotificationChannel>,
    @InjectRepository(NotificationLog)
    private readonly logRepo: Repository<NotificationLog>,
  ) {}

  private toChannelRow(ch: NotificationChannel): NotificationChannelRow {
    return {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      botToken: ch.botToken,
      chatId: ch.chatId,
      isActive: ch.isActive,
      createdAt: ch.createdAt.toISOString(),
    };
  }

  private toLogRow(log: NotificationLog): NotificationLogRow {
    return {
      id: log.id,
      channelId: log.channelId,
      channelName: log.channelName,
      message: log.message,
      status: log.status,
      sentAt: log.sentAt.toISOString(),
    };
  }

  async listChannels(userId: number): Promise<NotificationChannelRow[]> {
    const list = await this.channelRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return list.map((c) => this.toChannelRow(c));
  }

  async createChannel(
    userId: number,
    dto: CreateNotificationChannelDto,
  ): Promise<NotificationChannelRow> {
    const ch = this.channelRepo.create({
      userId,
      name: dto.name.trim(),
      type: 'telegram',
      botToken: dto.botToken.trim(),
      chatId: dto.chatId.trim(),
      isActive: true,
    });
    const saved = await this.channelRepo.save(ch);
    return this.toChannelRow(saved);
  }

  async updateChannel(
    userId: number,
    id: string,
    dto: UpdateNotificationChannelDto,
  ): Promise<NotificationChannelRow> {
    const ch = await this.channelRepo.findOne({ where: { id, userId } });
    if (!ch) throw new NotFoundException('Channel not found');
    if (dto.name !== undefined) ch.name = dto.name.trim();
    if (dto.botToken !== undefined) ch.botToken = dto.botToken.trim();
    if (dto.chatId !== undefined) ch.chatId = dto.chatId.trim();
    if (dto.isActive !== undefined) ch.isActive = dto.isActive;
    const saved = await this.channelRepo.save(ch);
    return this.toChannelRow(saved);
  }

  async deleteChannel(userId: number, id: string): Promise<void> {
    const res = await this.channelRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Channel not found');
  }

  async listLogs(userId: number): Promise<NotificationLogRow[]> {
    const list = await this.logRepo.find({
      where: { userId },
      order: { sentAt: 'DESC' },
      take: 500,
    });
    return list.map((l) => this.toLogRow(l));
  }

  private async persistLog(
    userId: number,
    channel: NotificationChannel,
    message: string,
    status: 'sent' | 'failed',
    errorDetail: string | null,
  ): Promise<NotificationLogRow> {
    const log = this.logRepo.create({
      userId,
      channelId: channel.id,
      channelName: channel.name,
      message,
      status,
      errorDetail,
    });
    const saved = await this.logRepo.save(log);
    return this.toLogRow(saved);
  }

  private async persistDraftLog(
    userId: number,
    channelName: string,
    message: string,
    status: 'sent' | 'failed',
    errorDetail: string | null,
  ): Promise<NotificationLogRow> {
    const log = this.logRepo.create({
      userId,
      channelId: null,
      channelName,
      message,
      status,
      errorDetail,
    });
    const saved = await this.logRepo.save(log);
    return this.toLogRow(saved);
  }

  /** Send test message using credentials not yet saved as a channel. */
  async testTelegramCredentials(
    userId: number,
    botToken: string,
    chatId: string,
    channelName?: string,
  ): Promise<NotificationLogRow> {
    const label = channelName?.trim() || 'Draft';
    const result = await sendTelegramMessage(
      botToken.trim(),
      chatId.trim(),
      NOTIFICATION_TEST_MESSAGE,
    );
    if (result.ok) {
      return this.persistDraftLog(
        userId,
        label,
        NOTIFICATION_TEST_MESSAGE,
        'sent',
        null,
      );
    }
    return this.persistDraftLog(
      userId,
      label,
      NOTIFICATION_TEST_MESSAGE,
      'failed',
      result.description,
    );
  }

  async sendMessage(
    userId: number,
    channelId: string,
    message: string,
  ): Promise<NotificationLogRow> {
    const channel = await this.channelRepo.findOne({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type !== 'telegram') {
      throw new ForbiddenException('Only Telegram channels are supported');
    }
    const result = await sendTelegramMessage(
      channel.botToken,
      channel.chatId,
      message,
    );
    if (result.ok) {
      return this.persistLog(userId, channel, message, 'sent', null);
    }
    const row = await this.persistLog(
      userId,
      channel,
      message,
      'failed',
      result.description,
    );
    return row;
  }

  async testChannel(userId: number, channelId: string): Promise<NotificationLogRow> {
    return this.sendMessage(userId, channelId, NOTIFICATION_TEST_MESSAGE);
  }
}
