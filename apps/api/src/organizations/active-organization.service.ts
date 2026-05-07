import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ResolveOrganizationWorkspaceOptions } from '../common/organization-workspace-scope';
import { RedisService } from '../common/redis/redis.service';
import type { OrganizationMemberContext } from './organizations.service';
import { OrganizationsService } from './organizations.service';

@Injectable()
export class ActiveOrganizationService {
  private readonly memoryFallback = new Map<number, string>();
  private readonly ttlMs: number;

  constructor(
    private readonly redis: RedisService,
    private readonly organizationsService: OrganizationsService,
    private readonly config: ConfigService,
  ) {
    const raw = Number(this.config.get<string>('ACTIVE_ORG_TTL_MS') ?? 0);
    this.ttlMs =
      Number.isFinite(raw) && raw > 0
        ? Math.trunc(raw)
        : 1000 * 60 * 60 * 24 * 30;
  }

  private key(userId: number): string {
    return `user:${userId}:active_org_public_id`;
  }

  private normalize(raw: string | null | undefined): string {
    return (raw ?? '').trim();
  }

  async getActiveOrganizationPublicId(userId: number): Promise<string | null> {
    const key = this.key(userId);
    try {
      const fromRedis = this.normalize(await this.redis.get(key));
      if (fromRedis) return fromRedis;
    } catch {
      // fall back to process memory when redis is unavailable
    }
    return this.memoryFallback.get(userId) ?? null;
  }

  async clearActiveOrganization(userId: number): Promise<void> {
    const key = this.key(userId);
    this.memoryFallback.delete(userId);
    try {
      await this.redis.del(key);
    } catch {
      // no-op
    }
  }

  async setActiveOrganizationPublicId(
    userId: number,
    organizationPublicId: string,
  ): Promise<string> {
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
    );
    const key = this.key(userId);
    this.memoryFallback.set(userId, ctx.publicId);
    try {
      await this.redis.setWithTtlMs(key, ctx.publicId, this.ttlMs);
    } catch {
      // no-op, in-memory fallback already set
    }
    return ctx.publicId;
  }

  async resolveRequiredMemberContext(
    userId: number,
    explicitOrganizationPublicId: string | null | undefined,
    opts?: ResolveOrganizationWorkspaceOptions,
  ): Promise<OrganizationMemberContext> {
    const explicit = this.normalize(explicitOrganizationPublicId);
    if (explicit) {
      const ctx = await this.organizationsService.requireMemberContext(
        explicit,
        userId,
        opts,
      );
      await this.setActiveOrganizationPublicId(userId, ctx.publicId);
      return ctx;
    }

    const active = await this.resolveOrBootstrapActiveOrganizationPublicId(
      userId,
    );
    if (!active) {
      throw new BadRequestException(
        'organizationPublicId is required until an active organization is set.',
      );
    }
    try {
      return await this.organizationsService.requireMemberContext(
        active,
        userId,
        opts,
      );
    } catch (error) {
      await this.clearActiveOrganization(userId);
      throw error;
    }
  }

  /**
   * Returns active organization when present, otherwise bootstraps a default
   * org context for new users and persists it as active.
   */
  private async resolveOrBootstrapActiveOrganizationPublicId(
    userId: number,
  ): Promise<string | null> {
    const current = await this.getActiveOrganizationPublicId(userId);
    if (current) return current;

    await this.organizationsService.ensureAtLeastOneOwnedOrganizationForUser(
      userId,
    );
    const first =
      await this.organizationsService.getFirstOrganizationPublicIdForUser(userId);
    if (!first) return null;

    await this.setActiveOrganizationPublicId(userId, first);
    return first;
  }

  async resolvePreferredOrganizationPublicId(
    userId: number,
    explicitOrganizationPublicId?: string | null,
  ): Promise<string | null> {
    const explicit = this.normalize(explicitOrganizationPublicId);
    if (explicit) {
      const ctx = await this.organizationsService.requireMemberContext(
        explicit,
        userId,
      );
      await this.setActiveOrganizationPublicId(userId, ctx.publicId);
      return ctx.publicId;
    }
    const active = await this.getActiveOrganizationPublicId(userId);
    if (!active) return null;
    try {
      const ctx = await this.organizationsService.requireMemberContext(
        active,
        userId,
      );
      return ctx.publicId;
    } catch {
      await this.clearActiveOrganization(userId);
      return null;
    }
  }
}
