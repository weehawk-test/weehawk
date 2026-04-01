import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NotificationLog } from './entities/notification-log.entity';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { sendTelegramMessage } from './telegram-api';
import { NotificationChannelType } from './entities/notification-channel-type.enum';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { ProviderResult } from './providers/provider.types';

export const NOTIFICATION_TEST_MESSAGE = 'test succedded';

export type NotificationChannelRow = {
  id: string;
  name: string;
  type: NotificationChannelType;
  credentialPreview: string;
  targetPreview: string;
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
    private readonly providerRegistry: ProviderRegistryService,
  ) {}

  private toChannelRow(
    ch: NotificationChannel,
    preview: { credentialPreview: string; targetPreview: string },
  ): NotificationChannelRow {
    return {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      credentialPreview: preview.credentialPreview,
      targetPreview: preview.targetPreview,
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

  private async sendViaChannel(
    channel: NotificationChannel,
    message: string,
  ): Promise<ProviderResult> {
    const provider = this.providerRegistry.get(channel.type);
    return provider.send(channel.id, channel.name, message);
  }

  private async saveProviderConfig(
    channel: NotificationChannel,
    config: Record<string, unknown>,
  ): Promise<void> {
    const provider = this.providerRegistry.get(channel.type);
    await provider.saveConfig(channel.id, config);
  }

  async listChannels(userId: number): Promise<NotificationChannelRow[]> {
    const list = await this.channelRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const rows: NotificationChannelRow[] = [];
    for (const channel of list) {
      const provider = this.providerRegistry.get(channel.type);
      const preview = await provider.preview(channel.id);
      rows.push(this.toChannelRow(channel, preview));
    }
    return rows;
  }

  async listChannelsPaged(
    userId: number,
    page: number,
    _pageSize: number,
    q?: string,
  ): Promise<{
    items: NotificationChannelRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const take = 10;
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * take;
    const qb = this.channelRepo
      .createQueryBuilder('c')
      .where('c.userId = :userId', { userId });
    const term = (q ?? '').trim();
    if (term) {
      qb.andWhere('(c.name ILIKE :term OR c.type::text ILIKE :term)', {
        term: `%${term}%`,
      });
    }
    qb.orderBy('c.createdAt', 'DESC').skip(skip).take(take);
    const [rows, total] = await qb.getManyAndCount();
    const items: NotificationChannelRow[] = [];
    for (const channel of rows) {
      const provider = this.providerRegistry.get(channel.type);
      const preview = await provider.preview(channel.id);
      items.push(this.toChannelRow(channel, preview));
    }
    return {
      items,
      total,
      page: safePage,
      pageSize: take,
    };
  }

  async createChannel(
    userId: number,
    dto: CreateNotificationChannelDto,
  ): Promise<NotificationChannelRow> {
    const config = dto.config ?? {};
    const ch = this.channelRepo.create({
      userId,
      name: dto.name.trim(),
      type: dto.type as NotificationChannelType,
      isActive: true,
    });
    const saved = await this.channelRepo.save(ch);
    await this.saveProviderConfig(saved, config);
    const preview = await this.providerRegistry
      .get(saved.type)
      .preview(saved.id);
    return this.toChannelRow(saved, preview);
  }

  async updateChannel(
    userId: number,
    id: string,
    dto: UpdateNotificationChannelDto,
  ): Promise<NotificationChannelRow> {
    const ch = await this.channelRepo.findOne({ where: { id, userId } });
    if (!ch) throw new NotFoundException('Channel not found');
    if (dto.name !== undefined) ch.name = dto.name.trim();
    if (dto.isActive !== undefined) ch.isActive = dto.isActive;
    const saved = await this.channelRepo.save(ch);
    if (dto.config !== undefined) {
      await this.saveProviderConfig(saved, dto.config);
    }
    const preview = await this.providerRegistry
      .get(saved.type)
      .preview(saved.id);
    return this.toChannelRow(saved, preview);
  }

  async deleteChannel(userId: number, id: string): Promise<void> {
    const res = await this.channelRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Channel not found');
  }

  async bulkDeleteChannels(
    userId: number,
    ids: string[],
  ): Promise<{ removed: number }> {
    if (ids.length === 0) return { removed: 0 };
    const res = await this.channelRepo
      .createQueryBuilder()
      .delete()
      .from(NotificationChannel)
      .where('user_id = :userId', { userId })
      .andWhere('id = ANY(:ids)', { ids })
      .execute();
    return { removed: res.affected ?? 0 };
  }

  async listLogs(userId: number): Promise<NotificationLogRow[]> {
    const list = await this.logRepo.find({
      where: { userId },
      order: { sentAt: 'DESC' },
      take: 500,
    });
    return list.map((l) => this.toLogRow(l));
  }

  async listLogsPaged(
    userId: number,
    page: number,
    _pageSize: number,
    q?: string,
  ): Promise<{
    items: NotificationLogRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    // Fixed batch size by design: always return exactly 10 items per page.
    const take = 10;
    const skip = (Math.max(1, page) - 1) * take;
    const qb = this.logRepo
      .createQueryBuilder('l')
      .where('l.userId = :userId', { userId });
    const term = (q ?? '').trim();
    if (term) {
      qb.andWhere('(l.channelName ILIKE :term OR l.message ILIKE :term)', {
        term: `%${term}%`,
      });
    }
    qb.orderBy('l.sentAt', 'DESC').skip(skip).take(take);
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((r) => this.toLogRow(r)),
      total,
      page: Math.max(1, page),
      pageSize: take,
    };
  }

  async deleteLog(userId: number, id: string): Promise<void> {
    await this.logRepo.delete({ id, userId });
  }

  async bulkDeleteLogs(
    userId: number,
    ids: string[],
  ): Promise<{ removed: number }> {
    if (ids.length === 0) return { removed: 0 };
    const res = await this.logRepo
      .createQueryBuilder()
      .delete()
      .from(NotificationLog)
      .where('user_id = :userId', { userId })
      .andWhere('id = ANY(:ids)', { ids })
      .execute();
    return { removed: res.affected ?? 0 };
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
    const result = await this.sendViaChannel(channel, message);
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

  async testChannel(
    userId: number,
    channelId: string,
  ): Promise<NotificationLogRow> {
    return this.sendMessage(userId, channelId, NOTIFICATION_TEST_MESSAGE);
  }
}
