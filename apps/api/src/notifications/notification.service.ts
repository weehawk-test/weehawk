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
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { formatNotificationPlainText } from './notification-format';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { channelConfigRecord } from './providers/channel-config';
import { ProviderSendResult } from './providers/provider.types';
import { withRetry } from './utils/with-retry';
import { RemoteServersService } from '../remote-servers/remote-servers.service';
import { generatePublicId, isLikelyNumericId } from '../common/public-id';

export const NOTIFICATION_TEST_MESSAGE = 'test succeeded';

export type NotificationChannelRow = {
  id: number;
  /** Opaque public identifier (e.g. `nch_…`), stable for URLs and sharing. */
  publicId?: string;
  name: string;
  type: NotificationChannelType;
  credentialPreview: string;
  targetPreview: string;
  isActive: boolean;
  /** When set, Send/Test uses SSH on this deploy host (curl from customer network). */
  remoteServerId: number | null;
  createdAt: string;
};

export type NotificationChannelRuntimeConfig = {
  id: number;
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
    private readonly providerRegistry: ProviderRegistryService,
    private readonly remoteServersService: RemoteServersService,
  ) {}

  private async ensureChannelPublicId(row: NotificationChannel): Promise<NotificationChannel> {
    if (row.publicId?.trim()) return row;
    row.publicId = generatePublicId('nch');
    return this.channelRepo.save(row);
  }

  private async findChannelForUser(
    userId: number,
    raw: string,
  ): Promise<NotificationChannel | null> {
    const t = String(raw).trim();
    const where = isLikelyNumericId(t)
      ? { id: Number(t), userId }
      : { publicId: t, userId };
    const ch = await this.channelRepo.findOne({ where });
    if (!ch) return null;
    return this.ensureChannelPublicId(ch);
  }

  private toChannelRow(
    ch: NotificationChannel,
    preview: { credentialPreview: string; targetPreview: string },
  ): NotificationChannelRow {
    const pid = ch.publicId?.trim();
    return {
      id: ch.id,
      publicId: pid ? pid : undefined,
      name: ch.name,
      type: ch.type,
      credentialPreview: preview.credentialPreview,
      targetPreview: preview.targetPreview,
      isActive: ch.isActive,
      remoteServerId: ch.remoteServerId ?? null,
      createdAt: ch.createdAt.toISOString(),
    };
  }

  /**
   * Retries only when the failure looks transient (rate limits, network blips).
   */
  private async sendWithRetry(
    channel: NotificationChannel,
    plainText: string,
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
          const result =
            await this.remoteServersService.deliverNotificationChannelViaDeployHost(
              channel.remoteServerId,
              channel.userId,
              runtime,
              plainText,
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

  /** Sends plain text to a channel via its deploy host (no persisted history). */
  async sendMessage(
    userId: number,
    channelId: number | string,
    message: string,
  ): Promise<void> {
    const channel = await this.findChannelForUser(userId, String(channelId));
    if (!channel) throw new NotFoundException('Channel not found');
    const text = formatNotificationPlainText('Notification', message);
    await this.sendWithRetry(channel, text);
  }

  async getChannelRuntimeConfig(
    userId: number,
    channelId: number | string,
  ): Promise<NotificationChannelRuntimeConfig> {
    const channel = await this.findChannelForUser(userId, String(channelId));
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
      const ch = await this.ensureChannelPublicId(channel);
      const provider = this.providerRegistry.get(ch.type);
      const preview = await provider.preview(ch);
      rows.push(this.toChannelRow(ch, preview));
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
      const ch = await this.ensureChannelPublicId(channel);
      const provider = this.providerRegistry.get(ch.type);
      const preview = await provider.preview(ch);
      items.push(this.toChannelRow(ch, preview));
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
    const ch = await this.findChannelForUser(userId, id);
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
    const ch = await this.findChannelForUser(userId, id);
    if (!ch) throw new NotFoundException('Channel not found');
    const res = await this.channelRepo.delete({ id: ch.id, userId });
    if (!res.affected) throw new NotFoundException('Channel not found');
  }

  async bulkDeleteChannels(
    userId: number,
    ids: number[],
  ): Promise<{ removed: number }> {
    if (ids.length === 0) return { removed: 0 };
    const res = await this.channelRepo
      .createQueryBuilder()
      .delete()
      .from(NotificationChannel)
      .where('id IN (:...ids)', { ids })
      .andWhere('user_id = :userId', { userId })
      .execute();
    return { removed: res.affected ?? 0 };
  }

  /**
   * Dry-run: sends the fixed test payload via the channel's deploy host (SSH + curl).
   */
  async testChannel(
    userId: number,
    channelId: string,
  ): Promise<{ success: boolean; message: string }> {
    const channel = await this.findChannelForUser(userId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    const text = formatNotificationPlainText('Test', NOTIFICATION_TEST_MESSAGE);
    const result = await this.sendWithRetry(channel, text);
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
