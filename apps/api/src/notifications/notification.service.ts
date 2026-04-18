import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NotificationChannelType } from './entities/notification-channel-type.enum';
import { NotificationDeliveryStatus } from './entities/notification-delivery-status.enum';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { Notification } from './entities/notification.entity';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { notificationPlainText } from './notification-format';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { channelConfigRecord } from './providers/channel-config';
import { ProviderSendResult } from './providers/provider.types';
import { withRetry } from './utils/with-retry';
import { RemoteServersService } from '../remote-servers/remote-servers.service';

export const NOTIFICATION_TEST_MESSAGE = 'test succeeded';

export type NotificationChannelRow = {
  id: string;
  name: string;
  type: NotificationChannelType;
  credentialPreview: string;
  targetPreview: string;
  isActive: boolean;
  /** When set, Send/Test uses SSH on this deploy host (curl from customer network). */
  remoteServerId: number | null;
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
    private readonly remoteServersService: RemoteServersService,
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
      remoteServerId: ch.remoteServerId ?? null,
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
          if (channel.remoteServerId == null) {
            return {
              ok: false,
              description:
                'This channel has no deploy host. Recreate it with a remote server id or PATCH remoteServerId.',
            };
          }
          const runtime: NotificationChannelRuntimeConfig = {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            config: channelConfigRecord(channel),
          };
          const text = notificationPlainText(notification);
          const result =
            await this.remoteServersService.deliverNotificationChannelViaDeployHost(
              channel.remoteServerId,
              channel.userId,
              runtime,
              text,
            );
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
    const remoteId =
      dto.remoteServerId != null ? dto.remoteServerId : null;
    if (remoteId != null) {
      await this.remoteServersService.findOne(remoteId, userId);
    }
    const ch = this.channelRepo.create({
      userId,
      name: dto.name.trim(),
      type: dto.type as NotificationChannelType,
      isActive: true,
      config,
      remoteServerId: remoteId,
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
    if (dto.remoteServerId !== undefined) {
      if (dto.remoteServerId === null) {
        throw new BadRequestException(
          'remoteServerId cannot be cleared; notifications are delivered only via deploy hosts.',
        );
      }
      await this.remoteServersService.findOne(dto.remoteServerId, userId);
      ch.remoteServerId = dto.remoteServerId;
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

  /**
   * Dry-run: sends the fixed test payload via the channel's deploy host (SSH + curl). Does not persist history rows.
   */
  async testChannel(
    userId: number,
    channelId: string,
  ): Promise<{ success: boolean; message: string }> {
    const channel = await this.channelRepo.findOne({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const notification = this.notificationRepo.create({
      userId,
      title: 'Test',
      message: NOTIFICATION_TEST_MESSAGE,
    });
    const result = await this.sendWithRetry(channel, notification);
    if (result.ok) {
      const msg =
        typeof result.response === 'string' && result.response.trim()
          ? result.response.trim()
          : 'test succeeded';
      return { success: true, message: msg };
    }
    return {
      success: false,
      message: (result.description ?? '').trim() || 'Test failed',
    };
  }
}
