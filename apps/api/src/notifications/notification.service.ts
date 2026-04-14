import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NotificationChannelType } from './entities/notification-channel-type.enum';
import { NotificationDeliveryStatus } from './entities/notification-delivery-status.enum';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { Notification } from './entities/notification.entity';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { sendTelegramMessage } from './telegram-api';
import { notificationPlainText } from './notification-format';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { channelConfigRecord } from './providers/channel-config';
import { ProviderSendResult } from './providers/provider.types';
import { withRetry } from './utils/with-retry';

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
  status: 'sent' | 'failed' | 'pending';
  sentAt: string;
  errorDetail: string | null;
};

export type NotificationChannelRuntimeConfig = {
  id: string;
  name: string;
  type: NotificationChannelType;
  config: Record<string, unknown>;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationChannel)
    private readonly channelRepo: Repository<NotificationChannel>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveryRepo: Repository<NotificationDelivery>,
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

  private toLogRow(
    delivery: NotificationDelivery,
    notification: Notification,
    options?: { channelName?: string },
  ): NotificationLogRow {
    const channelName =
      options?.channelName ?? delivery.channel?.name ?? 'Draft';
    const message = notificationPlainText(notification);
    const status =
      delivery.status === NotificationDeliveryStatus.SENT
        ? 'sent'
        : delivery.status === NotificationDeliveryStatus.PENDING
          ? 'pending'
          : 'failed';
    const errorDetail =
      delivery.status === NotificationDeliveryStatus.FAILED
        ? delivery.response
        : null;
    const sentAt = (delivery.sentAt ?? delivery.createdAt).toISOString();
    return {
      id: delivery.id,
      channelId: delivery.channelId,
      channelName,
      message,
      status,
      sentAt,
      errorDetail,
    };
  }

  private serializeResponse(
    result: ProviderSendResult,
  ): string | null {
    if (result.ok) {
      if (result.response === undefined) return null;
      return typeof result.response === 'string'
        ? result.response
        : JSON.stringify(result.response);
    }
    return result.description ?? 'failed';
  }

  /**
   * Retries only when the failure looks transient (rate limits, network blips).
   */
  private async sendWithRetry(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    try {
      return await withRetry(
        async () => {
          const provider = this.providerRegistry.get(channel.type);
          const result = await provider.send(channel, notification);
          if (result.ok) return result;
          const desc = result.description ?? '';
          const transient = /429|rate|timeout|ECONNRESET|ETIMEDOUT|socket|network/i.test(
            desc,
          );
          if (transient) throw new Error(desc);
          return result;
        },
        {
          retries: 2,
          baseDelayMs: 400,
          onRetry: (attempt, err) =>
            this.logger.warn(
              `Retry ${attempt} sending to channel ${channel.id}: ${err}`,
            ),
        },
      );
    } catch (e) {
      const description =
        e instanceof Error ? e.message : 'Notification send failed';
      return { ok: false, description };
    }
  }

  /**
   * Creates a notification and delivers it to every active channel for the user.
   */
  async sendToUser(
    userId: number,
    title: string,
    message: string,
  ): Promise<{ notificationId: string; logs: NotificationLogRow[] }> {
    const notification = this.notificationRepo.create({
      userId,
      title: title.trim() || 'Notification',
      message,
    });
    const savedNotification = await this.notificationRepo.save(notification);

    const channels = await this.channelRepo.find({
      where: { userId, isActive: true },
      order: { createdAt: 'ASC' },
    });

    const logs: NotificationLogRow[] = [];

    for (const channel of channels) {
      const delivery = this.deliveryRepo.create({
        notificationId: savedNotification.id,
        channelId: channel.id,
        status: NotificationDeliveryStatus.PENDING,
        response: null,
        sentAt: null,
      });
      const savedDelivery = await this.deliveryRepo.save(delivery);

      let result: ProviderSendResult;
      try {
        result = await this.sendWithRetry(channel, savedNotification);
      } catch (e) {
        this.logger.error(
          `Unexpected error sending to channel ${channel.id}`,
          e instanceof Error ? e.stack : e,
        );
        result = {
          ok: false,
          description:
            e instanceof Error ? e.message : 'Unexpected notification error',
        };
      }

      const now = new Date();
      savedDelivery.status = result.ok
        ? NotificationDeliveryStatus.SENT
        : NotificationDeliveryStatus.FAILED;
      savedDelivery.response = this.serializeResponse(result);
      savedDelivery.sentAt = now;
      await this.deliveryRepo.save(savedDelivery);

      const withChannel = await this.deliveryRepo.findOne({
        where: { id: savedDelivery.id },
        relations: ['channel'],
      });
      logs.push(
        this.toLogRow(withChannel ?? savedDelivery, savedNotification, {}),
      );
    }

    return { notificationId: savedNotification.id, logs };
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

    const notification = this.notificationRepo.create({
      userId,
      title: 'Notification',
      message,
    });
    const savedNotification = await this.notificationRepo.save(notification);

    const delivery = this.deliveryRepo.create({
      notificationId: savedNotification.id,
      channelId: channel.id,
      status: NotificationDeliveryStatus.PENDING,
      response: null,
      sentAt: null,
    });
    const savedDelivery = await this.deliveryRepo.save(delivery);

    const result = await this.sendWithRetry(channel, savedNotification);
    const now = new Date();
    savedDelivery.status = result.ok
      ? NotificationDeliveryStatus.SENT
      : NotificationDeliveryStatus.FAILED;
    savedDelivery.response = this.serializeResponse(result);
    savedDelivery.sentAt = now;
    await this.deliveryRepo.save(savedDelivery);

    const withChannel = await this.deliveryRepo.findOne({
      where: { id: savedDelivery.id },
      relations: ['channel'],
    });
    return this.toLogRow(withChannel ?? savedDelivery, savedNotification, {});
  }

  async getChannelRuntimeConfig(
    userId: number,
    channelId: string,
  ): Promise<NotificationChannelRuntimeConfig> {
    const channel = await this.channelRepo.findOne({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      config: channelConfigRecord(channel),
    };
  }

  async listChannels(userId: number): Promise<NotificationChannelRow[]> {
    const list = await this.channelRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const rows: NotificationChannelRow[] = [];
    for (const channel of list) {
      const provider = this.providerRegistry.get(channel.type);
      const preview = await provider.preview(channel);
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
      const preview = await provider.preview(channel);
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
    const provider = this.providerRegistry.get(
      dto.type as NotificationChannelType,
    );
    const config = provider.normalizeConfig(dto.config ?? {});
    const ch = this.channelRepo.create({
      userId,
      name: dto.name.trim(),
      type: dto.type as NotificationChannelType,
      isActive: true,
      config,
    });
    const saved = await this.channelRepo.save(ch);
    const preview = await provider.preview(saved);
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
    if (dto.config !== undefined) {
      const provider = this.providerRegistry.get(ch.type);
      ch.config = provider.normalizeConfig({
        ...channelConfigRecord(ch),
        ...dto.config,
      });
    }
    const saved = await this.channelRepo.save(ch);
    const preview = await this.providerRegistry.get(saved.type).preview(saved);
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
      .where('id = ANY(:ids)', { ids })
      .andWhere('user_id = :userId', { userId })
      .execute();
    return { removed: res.affected ?? 0 };
  }

  async listLogs(userId: number): Promise<NotificationLogRow[]> {
    const rows = await this.deliveryRepo
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.notification', 'n')
      .leftJoinAndSelect('d.channel', 'c')
      .where('n.userId = :userId', { userId })
      .orderBy('d.sentAt', 'DESC', 'NULLS LAST')
      .addOrderBy('d.createdAt', 'DESC')
      .take(500)
      .getMany();
    return rows.map((d) => this.toLogRow(d, d.notification, {}));
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
    const take = 10;
    const skip = (Math.max(1, page) - 1) * take;
    const qb = this.deliveryRepo
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.notification', 'n')
      .leftJoinAndSelect('d.channel', 'c')
      .where('n.userId = :userId', { userId });
    const term = (q ?? '').trim();
    if (term) {
      qb.andWhere(
        '(c.name ILIKE :term OR n.message ILIKE :term OR n.title ILIKE :term)',
        { term: `%${term}%` },
      );
    }
    qb.orderBy('d.sentAt', 'DESC', 'NULLS LAST')
      .addOrderBy('d.createdAt', 'DESC')
      .skip(skip)
      .take(take);
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((d) => this.toLogRow(d, d.notification, {})),
      total,
      page: Math.max(1, page),
      pageSize: take,
    };
  }

  async deleteLog(userId: number, id: string): Promise<void> {
    await this.deliveryRepo
      .createQueryBuilder()
      .delete()
      .from(NotificationDelivery)
      .where(
        'id IN (SELECT d2.id FROM notification_deliveries d2 INNER JOIN notifications n2 ON n2.id = d2.notification_id WHERE d2.id = :id AND n2.user_id = :userId)',
        { id, userId },
      )
      .execute();
  }

  async bulkDeleteLogs(
    userId: number,
    ids: string[],
  ): Promise<{ removed: number }> {
    if (ids.length === 0) return { removed: 0 };
    const res = await this.deliveryRepo
      .createQueryBuilder()
      .delete()
      .from(NotificationDelivery)
      .where(
        'id IN (SELECT d2.id FROM notification_deliveries d2 INNER JOIN notifications n2 ON n2.id = d2.notification_id WHERE d2.id IN (:...ids) AND n2.user_id = :userId)',
        { ids, userId },
      )
      .execute();
    return { removed: res.affected ?? 0 };
  }

  private async persistDraftLog(
    userId: number,
    channelName: string,
    title: string,
    message: string,
    status: 'sent' | 'failed',
    errorDetail: string | null,
  ): Promise<NotificationLogRow> {
    const notification = this.notificationRepo.create({
      userId,
      title,
      message,
    });
    const savedN = await this.notificationRepo.save(notification);
    const delivery = this.deliveryRepo.create({
      notificationId: savedN.id,
      channelId: null,
      status:
        status === 'sent'
          ? NotificationDeliveryStatus.SENT
          : NotificationDeliveryStatus.FAILED,
      response: errorDetail,
      sentAt: new Date(),
    });
    const savedD = await this.deliveryRepo.save(delivery);
    return this.toLogRow(savedD, savedN, { channelName: channelName });
  }

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
        'Credential test',
        NOTIFICATION_TEST_MESSAGE,
        'sent',
        null,
      );
    }
    return this.persistDraftLog(
      userId,
      label,
      'Credential test',
      NOTIFICATION_TEST_MESSAGE,
      'failed',
      result.description,
    );
  }

  async testChannel(
    userId: number,
    channelId: string,
  ): Promise<NotificationLogRow> {
    const channel = await this.channelRepo.findOne({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const notification = this.notificationRepo.create({
      userId,
      title: 'Test',
      message: NOTIFICATION_TEST_MESSAGE,
    });
    const savedNotification = await this.notificationRepo.save(notification);

    const delivery = this.deliveryRepo.create({
      notificationId: savedNotification.id,
      channelId: channel.id,
      status: NotificationDeliveryStatus.PENDING,
      response: null,
      sentAt: null,
    });
    const savedDelivery = await this.deliveryRepo.save(delivery);

    const result = await this.sendWithRetry(channel, savedNotification);
    const now = new Date();
    savedDelivery.status = result.ok
      ? NotificationDeliveryStatus.SENT
      : NotificationDeliveryStatus.FAILED;
    savedDelivery.response = this.serializeResponse(result);
    savedDelivery.sentAt = now;
    await this.deliveryRepo.save(savedDelivery);

    const withChannel = await this.deliveryRepo.findOne({
      where: { id: savedDelivery.id },
      relations: ['channel'],
    });
    return this.toLogRow(withChannel ?? savedDelivery, savedNotification, {});
  }
}
