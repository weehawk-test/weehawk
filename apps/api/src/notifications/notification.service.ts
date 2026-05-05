import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import { resolveRequiredOrganizationInternalIdForMember } from '../common/organization-workspace-scope';
import {
  ORGANIZATION_WORKSPACE_PERMISSIONS,
  type OrganizationWorkspacePermission,
} from '../organizations/organization-workspace-permissions';
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
import { generatePublicId } from '../common/public-id';
import { RemoteServerTenantScopedRepository } from '../common/tenant-scoped.service';
import { OrgRealtimeEmitter } from '../org-realtime/org-realtime-emitter.service';

export const NOTIFICATION_TEST_MESSAGE = 'test succeeded';

export type NotificationChannelRow = {
  id: number;
  /** Opaque public identifier (e.g. `nch_…`), stable for URLs and sharing. */
  publicId?: string;
  name: string;
  type: NotificationChannelType;
  credentialPreview: string;
  targetPreview: string;
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
  private readonly scopedChannels: RemoteServerTenantScopedRepository<NotificationChannel>;

  constructor(
    @InjectRepository(NotificationChannel)
    private readonly channelRepo: Repository<NotificationChannel>,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepo: Repository<OrganizationMembership>,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly remoteServersService: RemoteServersService,
    private readonly orgRealtime: OrgRealtimeEmitter,
  ) {
    this.scopedChannels = new RemoteServerTenantScopedRepository<NotificationChannel>(
      this.channelRepo,
      this.membershipRepo,
      'Channel',
    );
  }

  private async requireWorkspaceOrgId(
    userId: number,
    organizationPublicId?: string | null,
    extra?: OrganizationWorkspacePermission[],
  ): Promise<number> {
    return resolveRequiredOrganizationInternalIdForMember(
      this.organizationsRepository,
      userId,
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS,
        ...(extra != null && extra.length > 0
          ? { requireAllWorkspaceAreas: extra }
          : {}),
      },
    );
  }

  private logNotificationChannelAudit(
    organizationId: number,
    userId: number,
    action: string,
    endpoint: string,
    channel: Pick<NotificationChannel, 'name' | 'publicId' | 'id'>,
    extra?: Record<string, unknown>,
  ): void {
    void this.organizationsService
      .appendOrganizationAuditEvent(organizationId, userId, action, {
        metadata: {
          endpoint,
          notificationChannelPublicId: channel.publicId?.trim() || null,
          notificationChannelName: channel.name,
          notificationChannelId: channel.id,
          ...(extra ?? {}),
        },
      })
      .catch(() => undefined);
  }

  private assertChannelWorkspace(
    ch: NotificationChannel,
    expectedOrgId: number,
  ): void {
    const rowOrg = ch.organizationId ?? null;
    if (rowOrg !== expectedOrgId) {
      throw new NotFoundException('Channel not found');
    }
  }

  private async ensureChannelPublicId(
    row: NotificationChannel,
  ): Promise<NotificationChannel> {
    if (row.publicId?.trim()) return row;
    row.publicId = generatePublicId('nch');
    return this.scopedChannels.saveScoped(row, row.userId);
  }

  private async findChannelForUser(
    userId: number,
    raw: string,
  ): Promise<NotificationChannel | null> {
    const t = String(raw).trim();
    try {
      if (/^\d+$/.test(t)) {
        const ch = await this.scopedChannels.findScoped(Number(t), userId);
        return this.ensureChannelPublicId(ch);
      }
      const ch = await this.scopedChannels.findScopedBy('publicId', t, userId);
      return this.ensureChannelPublicId(ch);
    } catch {
      return null;
    }
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
          const transient =
            /429|rate|timeout|ECONNRESET|ETIMEDOUT|socket|network/i.test(desc);
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

  async listChannels(
    userId: number,
    organizationPublicId?: string | null,
  ): Promise<NotificationChannelRow[]> {
    const orgId = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
    );
    const list = await this.scopedChannels.listForOrganization(
      userId,
      orgId,
      {
        order: { createdAt: 'DESC' },
      },
    );
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
    organizationPublicId?: string | null,
  ): Promise<{
    items: NotificationChannelRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const orgId = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
    );
    const take = 10;
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * take;
    const qb = this.channelRepo.createQueryBuilder('c');
    qb.where('c.organization_id = :orgId', { orgId });
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
    const orgId = await this.requireWorkspaceOrgId(
      userId,
      dto.organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_ADD],
    );
    const provider = this.providerRegistry.get(
      dto.type as NotificationChannelType,
    );
    const config = provider.normalizeConfig(dto.config ?? {});
    const remoteId = dto.remoteServerId != null ? dto.remoteServerId : null;
    if (remoteId != null) {
      await this.remoteServersService.findOne(remoteId, userId);
    }
    const ch = this.channelRepo.create({
      userId,
      organizationId: orgId,
      name: dto.name.trim(),
      type: dto.type as NotificationChannelType,
      config,
      remoteServerId: remoteId,
    });
    const saved = await this.scopedChannels.saveScoped(ch, userId);
    const preview = await provider.preview(saved);
    this.logNotificationChannelAudit(
      orgId,
      userId,
      'security.notification_channel.created',
      'POST /api/notifications/channels',
      saved,
    );
    this.orgRealtime.notifyOrgDataChanged(orgId, {
      entity: 'notification_channel',
      action: 'created',
      publicId: saved.publicId,
      resourceId: saved.id,
    });
    return this.toChannelRow(saved, preview);
  }

  async updateChannel(
    userId: number,
    id: string,
    dto: UpdateNotificationChannelDto,
    organizationPublicId?: string | null,
  ): Promise<NotificationChannelRow> {
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT],
    );
    const ch = await this.findChannelForUser(userId, id);
    if (!ch) throw new NotFoundException('Channel not found');
    this.assertChannelWorkspace(ch, expectedOrg);
    if (dto.name !== undefined) ch.name = dto.name.trim();
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
    const saved = await this.scopedChannels.saveScoped(ch, userId);
    const preview = await this.providerRegistry.get(saved.type).preview(saved);
    const channelPathId = encodeURIComponent(saved.publicId!.trim());
    this.logNotificationChannelAudit(
      expectedOrg,
      userId,
      'security.notification_channel.updated',
      `PATCH /api/notifications/channels/${channelPathId}`,
      saved,
    );
    this.orgRealtime.notifyOrgDataChanged(expectedOrg, {
      entity: 'notification_channel',
      action: 'updated',
      publicId: saved.publicId,
      resourceId: saved.id,
    });
    return this.toChannelRow(saved, preview);
  }

  async deleteChannel(
    userId: number,
    id: string,
    organizationPublicId?: string | null,
  ): Promise<void> {
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT],
    );
    const ch = await this.findChannelForUser(userId, id);
    if (!ch) throw new NotFoundException('Channel not found');
    this.assertChannelWorkspace(ch, expectedOrg);
    const channelPathId = encodeURIComponent(ch.publicId!.trim());
    this.logNotificationChannelAudit(
      expectedOrg,
      userId,
      'security.notification_channel.deleted',
      `DELETE /api/notifications/channels/${channelPathId}`,
      ch,
    );
    await this.scopedChannels.deleteScoped(ch.id, userId);
    if (expectedOrg >= 1) {
      this.orgRealtime.notifyOrgDataChanged(expectedOrg, {
        entity: 'notification_channel',
        action: 'deleted',
        publicId: ch.publicId,
        resourceId: ch.id,
      });
    }
  }

  async bulkDeleteChannels(
    userId: number,
    ids: string[],
    organizationPublicId?: string | null,
  ): Promise<{ removed: number }> {
    if (ids.length === 0) return { removed: 0 };
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT],
    );
    let removed = 0;
    for (const rawId of ids) {
      const id = String(rawId ?? '').trim();
      if (!id) continue;
      const ch = await this.findChannelForUser(userId, id);
      if (!ch) continue;
      this.assertChannelWorkspace(ch, expectedOrg);
      await this.scopedChannels.deleteScoped(ch.id, userId);
      removed += 1;
    }
    if (removed > 0) {
      void this.organizationsService
        .appendOrganizationAuditEvent(
          expectedOrg,
          userId,
          'security.notification_channels.bulk_deleted',
          {
            metadata: {
              endpoint: 'POST /api/notifications/channels/bulk-delete',
              removedCount: removed,
            },
          },
        )
        .catch(() => undefined);
      this.orgRealtime.notifyOrgDataChanged(expectedOrg, {
        entity: 'notification_channel',
        action: 'bulk_deleted',
      });
    }
    return { removed };
  }

  /**
   * Dry-run: sends the fixed test payload via the channel's deploy host (SSH + curl).
   */
  async testChannel(
    userId: number,
    channelId: string,
    organizationPublicId?: string | null,
  ): Promise<{ success: boolean; message: string }> {
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_TEST],
    );
    const channel = await this.findChannelForUser(userId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    this.assertChannelWorkspace(channel, expectedOrg);

    const text = formatNotificationPlainText('Test', NOTIFICATION_TEST_MESSAGE);
    const result = await this.sendWithRetry(channel, text);
    const out = result.ok
      ? {
          success: true as const,
          message:
            typeof result.response === 'string' && result.response.trim()
              ? result.response.trim()
              : 'test succeeded',
        }
      : {
          success: false as const,
          message: (result.description ?? '').trim() || 'Test failed',
        };
    const testPathId = encodeURIComponent(channel.publicId!.trim());
    void this.organizationsService
      .appendOrganizationAuditEvent(
        expectedOrg,
        userId,
        'security.notification_channel.tested',
        {
          metadata: {
            endpoint: `POST /api/notifications/channels/${testPathId}/test`,
            success: out.success,
            notificationChannelPublicId: channel.publicId?.trim() || null,
            notificationChannelName: channel.name,
          },
        },
      )
      .catch(() => undefined);
    return out;
  }
}
