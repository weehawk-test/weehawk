import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { OrganizationAuditLog } from './entities/organization-audit-log.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationsRepository } from './organizations.repository';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { parseOrganizationPublicIdParam } from './org-public-id';
import { ORGANIZATION_MEMBER_ROLE } from './organization-member-role';
import type { OrganizationMemberRole } from './organization-member-role';
import { User } from '../auth/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { RemoteServer } from '../remote-servers/entities/remote-server.entity';
import { Webhook } from '../webhooks/entities/webhook.entity';
import { CronJob } from '../cron-jobs/entities/cron-job.entity';
import { NotificationChannel } from '../notifications/entities/notification-channel.entity';
import { S3Profile } from '../s3/entities/s3-profile.entity';
import { TraefikSettings } from '../traefik/entities/traefik-settings.entity';
import { RemoteServerProvisionJob } from '../remote-servers/entities/remote-server-provision-job.entity';
import { generatePublicId } from '../common/public-id';
import { auditHttpContextStorage } from '../common/audit-http-context.storage';
import type { ResolveOrganizationWorkspaceOptions } from '../common/organization-workspace-scope';
import {
  allWorkspacePermissionsAllowed,
  effectiveWorkspacePermissions,
  isOrganizationWorkspacePermission,
  membershipAllowsWorkspaceArea,
  membershipHasOrgServerAccess,
  mergeWorkspacePermissionPatch,
  ORGANIZATION_WORKSPACE_PERMISSIONS,
  type OrganizationWorkspacePermission,
} from './organization-workspace-permissions';

export type OrganizationPublicDto = {
  publicId: string;
  name: string;
  isOwner: boolean;
  createdAt: Date;
  /** Total members (including you). Used for leave/owner UX. */
  memberCount: number;
  /** Effective workspace area access for the current user. */
  workspacePermissions: Record<OrganizationWorkspacePermission, boolean>;
};

export type OrganizationMemberContext = {
  internalId: number;
  publicId: string;
  name: string;
  /** Legacy column; kept in sync with membership roles for older code paths. */
  ownerId: number;
  createdAt: Date;
  /** Session user whose membership was resolved for this request. */
  actingUserId: number;
  /** True when the acting user’s membership role is owner. */
  actingIsOwner: boolean;
  workspacePermissions: Record<OrganizationWorkspacePermission, boolean>;
};

export type OrganizationMemberPublicDto = {
  email: string;
  firstName: string;
  lastName: string;
  isOwner: boolean;
  joinedAt: string;
  workspacePermissions: Record<OrganizationWorkspacePermission, boolean>;
};

export type OrganizationProjectPublicDto = {
  publicId: string;
  name: string;
  description: string;
  createdAt: string;
  serviceCount: number;
};

export type OrganizationAuditLogPublicDto = {
  id: number;
  action: string;
  createdAt: string;
  actorUserId: number;
  actorEmail: string;
  metadata: Record<string, unknown> | null;
};

export type OrganizationAuditLogPageDto = {
  items: OrganizationAuditLogPublicDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

@Injectable()
export class OrganizationsService implements OnModuleInit {
  constructor(
    private readonly repo: OrganizationsRepository,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(OrganizationAuditLog)
    private readonly auditLogs: Repository<OrganizationAuditLog>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.backfillOwnerRolesFromLegacyColumn();
  }

  /** One-time style sync: membership rows for legacy `organizations.owner_id` become role owner. */
  private async backfillOwnerRolesFromLegacyColumn(): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(OrganizationMembership)
      .set({ role: ORGANIZATION_MEMBER_ROLE.OWNER })
      .where(
        `EXISTS (
          SELECT 1 FROM organizations o
          WHERE o.id = organization_memberships.organization_id
            AND o.owner_id = organization_memberships.user_id
        )`,
      )
      .execute();
  }

  /**
   * Keeps `organizations.owner_id` aligned with owners (minimum user id) for code that still reads it.
   */
  private async syncLegacyOwnerIdColumn(organizationId: number): Promise<void> {
    const ownerIds = await this.repo.listOwnerUserIds(organizationId);
    if (ownerIds.length === 0) return;
    const nextOwnerId = Math.min(...ownerIds);
    const orgRow = await this.repo.findById(organizationId);
    if (!orgRow || orgRow.ownerId === nextOwnerId) return;
    orgRow.ownerId = nextOwnerId;
    await this.repo.saveOrganization(orgRow);
  }

  /**
   * Call before removing a user’s owner role in `organizationInternalId` (leave, dissolve, or demote).
   * Ensures they will still be owner of at least one organization afterward.
   */
  private async assertKeepsAtLeastOneOwnedOrganizationAfterLosingOwnerHere(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (m?.role !== ORGANIZATION_MEMBER_ROLE.OWNER) {
      return;
    }
    const owned = await this.repo.countOrganizationsWhereUserIsOwner(userId);
    if (owned <= 1) {
      throw new ConflictException(
        'You must maintain at least one organization where you are the owner. Create another organization first, or transfer ownership to another member before leaving.',
      );
    }
  }

  private sanitizeCreateName(dto: CreateOrganizationDto): string {
    const name = dto.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Organization name is required');
    return name;
  }

  toPublicDto(
    org: Organization,
    actingUserIsOwner: boolean,
    memberCount: number,
    membership: OrganizationMembership | null,
  ): OrganizationPublicDto {
    return {
      publicId: org.publicId,
      name: org.name,
      isOwner: actingUserIsOwner,
      createdAt: org.createdAt,
      memberCount,
      workspacePermissions: membership
        ? effectiveWorkspacePermissions(membership)
        : allWorkspacePermissionsAllowed(),
    };
  }

  memberContextToPublicDto(
    ctx: OrganizationMemberContext,
    memberCount: number,
  ): OrganizationPublicDto {
    return {
      publicId: ctx.publicId,
      name: ctx.name,
      isOwner: ctx.actingIsOwner,
      createdAt: ctx.createdAt,
      memberCount,
      workspacePermissions: ctx.workspacePermissions,
    };
  }

  /** Merge `httpStatus` from the current HTTP response when missing from metadata. */
  private mergeAuditMetadataWithHttpStatus(
    metadata: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    const base: Record<string, unknown> =
      metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...metadata }
        : {};
    const explicit = base.httpStatus;
    const hasExplicit =
      explicit !== undefined &&
      explicit !== null &&
      !(typeof explicit === 'string' && explicit.trim() === '');
    if (!hasExplicit) {
      const res = auditHttpContextStorage.getStore()?.res;
      const code = res?.statusCode;
      if (
        typeof code === 'number' &&
        Number.isFinite(code) &&
        code >= 100 &&
        code <= 599
      ) {
        base.httpStatus = code;
      }
    }
    return Object.keys(base).length > 0 ? base : null;
  }

  /** Append a row to the organization audit log (best-effort callers await). */
  async appendOrganizationAuditEvent(
    organizationInternalId: number,
    actorUserId: number,
    action: string,
    options?: {
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const row = this.auditLogs.create({
      organizationId: organizationInternalId,
      actorUserId,
      action: action.trim().slice(0, 64),
      metadata: this.mergeAuditMetadataWithHttpStatus(options?.metadata),
    });
    await this.auditLogs.save(row);
  }

  private static tryParseOrganizationPublicIdForAudit(
    raw: unknown,
  ): string | null {
    try {
      return parseOrganizationPublicIdParam(raw);
    } catch {
      return null;
    }
  }

  private static shouldSkipHttpFailureAuditPath(urlPath: string): boolean {
    if (!urlPath.startsWith('/api/')) {
      return true;
    }
    if (
      urlPath.startsWith('/api/webhooks') ||
      urlPath.startsWith('/api/cron-jobs')
    ) {
      return true;
    }
    return false;
  }

  private static summarizeHttpException(exception: HttpException): string {
    const r = exception.getResponse();
    if (typeof r === 'string') {
      return r.trim().slice(0, 400);
    }
    if (r && typeof r === 'object' && 'message' in r) {
      const m = (r as { message: unknown }).message;
      if (typeof m === 'string') return m.trim().slice(0, 400);
      if (Array.isArray(m)) {
        return m
          .map((x) => String(x))
          .join('; ')
          .trim()
          .slice(0, 400);
      }
    }
    return exception.message.trim().slice(0, 400);
  }

  /**
   * When an org-scoped API call returns 4xx, append a row so the audit log includes
   * denied / validation failures, not only successful mutations.
   */
  async appendOrganizationSecurityFailureAuditIfApplicable(
    req: Request,
    exception: HttpException,
  ): Promise<void> {
    const status = exception.getStatus();
    if (!Number.isFinite(status) || status < 400 || status >= 500) {
      return;
    }
    const userIdRaw = (req as Request & { user?: { userId?: number } }).user
      ?.userId;
    if (
      typeof userIdRaw !== 'number' ||
      !Number.isFinite(userIdRaw) ||
      userIdRaw < 1
    ) {
      return;
    }
    const userId = Math.trunc(userIdRaw);

    const q = req.query as Record<string, unknown> | undefined;
    const b = req.body as Record<string, unknown> | undefined;
    const rawOrg = q?.['organizationPublicId'] ?? b?.['organizationPublicId'];
    const orgPublicId =
      OrganizationsService.tryParseOrganizationPublicIdForAudit(rawOrg);
    if (!orgPublicId) {
      return;
    }

    const path =
      typeof req.path === 'string' && req.path.length > 0
        ? req.path
        : new URL(req.url, 'http://localhost').pathname;
    if (OrganizationsService.shouldSkipHttpFailureAuditPath(path)) {
      return;
    }

    const org = await this.repo.findByPublicId(orgPublicId);
    if (!org) {
      return;
    }

    const member = await this.repo.findMembership(userId, org.id);
    const isMember = Boolean(member);
    const reason: string = !isMember
      ? 'not_organization_member'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 422
            ? 'validation'
            : status === 409
              ? 'conflict'
              : 'client_error';

    const method = String(req.method ?? 'GET').toUpperCase();
    const fullPath =
      typeof req.originalUrl === 'string' && req.originalUrl.length > 0
        ? req.originalUrl.split('?')[0] ?? path
        : path;
    const endpoint = `${method} ${fullPath}`.slice(0, 512);
    const errorSummary =
      OrganizationsService.summarizeHttpException(exception);

    await this.appendOrganizationAuditEvent(
      org.id,
      userId,
      'security.http.request_rejected',
      {
        metadata: {
          endpoint,
          httpStatus: status,
          organizationPublicId: orgPublicId,
          reason,
          errorSummary,
        },
      },
    );
  }

  async listAuditLogsForOrg(
    ctx: OrganizationMemberContext,
    opts?: { page?: number; pageSize?: number },
  ): Promise<OrganizationAuditLogPageDto> {
    if (
      !ctx.actingIsOwner &&
      !ctx.workspacePermissions[
        ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG
      ]
    ) {
      throw new ForbiddenException(
        'You do not have permission to view the organization audit log.',
      );
    }
    const rawPage = Number(opts?.page ?? 1);
    const rawSize = Number(opts?.pageSize ?? 12);
    const pageSize = Math.min(50, Math.max(1, Number.isFinite(rawSize) ? Math.trunc(rawSize) : 12));
    let page = Math.max(1, Number.isFinite(rawPage) ? Math.trunc(rawPage) : 1);

    const total = await this.auditLogs.count({
      where: { organizationId: ctx.internalId },
    });
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    if (totalPages > 0) {
      page = Math.min(page, totalPages);
    }

    const skip = (page - 1) * pageSize;
    const rows = await this.auditLogs.find({
      where: { organizationId: ctx.internalId },
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
    });
    if (rows.length === 0) {
      return {
        items: [],
        total,
        page: total === 0 ? 1 : page,
        pageSize,
        totalPages,
      };
    }
    const actorIds = [...new Set(rows.map((r) => r.actorUserId))];
    const actors = await this.users.find({ where: { id: In(actorIds) } });
    const emailById = new Map(actors.map((u) => [u.id, u.email]));
    const items = rows.map((r) => ({
      id: r.id,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      actorUserId: r.actorUserId,
      actorEmail: emailById.get(r.actorUserId) ?? '(unknown)',
      metadata: r.metadata,
    }));
    return { items, total, page, pageSize, totalPages };
  }

  async getOnePublicForMember(
    ctx: OrganizationMemberContext,
  ): Promise<OrganizationPublicDto> {
    const memberCount = await this.repo.countMembershipsForOrganization(
      ctx.internalId,
    );
    return this.memberContextToPublicDto(ctx, memberCount);
  }

  async create(
    userId: number,
    dto: CreateOrganizationDto,
  ): Promise<OrganizationPublicDto> {
    const name = this.sanitizeCreateName(dto);
    const publicId = generatePublicId('org');
    const org = new Organization();
    org.name = name;
    org.publicId = publicId;
    org.ownerId = userId;
    const saved = await this.repo.saveOrganization(org);
    const membership = new OrganizationMembership();
    membership.userId = userId;
    membership.organizationId = saved.id;
    membership.role = ORGANIZATION_MEMBER_ROLE.OWNER;
    await this.repo.saveMembership(membership);
    await this.appendOrganizationAuditEvent(saved.id, userId, 'org.created', {
      metadata: { name },
    });
    const memberCount = await this.repo.countMembershipsForOrganization(saved.id);
    return this.toPublicDto(saved, true, memberCount, membership);
  }

  /**
   * Ensures the user belongs to at least one organization (as owner of a new one if needed).
   * Used after registration/login so accounts never stay without an organization.
   */
  async ensureAtLeastOneOwnedOrganizationForUser(userId: number): Promise<void> {
    const n = await this.repo.countMembershipsForUser(userId);
    if (n > 0) return;
    const userRow = await this.users.findOne({ where: { id: userId } });
    if (!userRow) return;
    await this.create(userId, {
      name: this.defaultOrganizationNameForNewUser(userRow),
    });
  }

  /**
   * Default org uses the same label users see on their account (e.g. "Adam D"), not "…'s organization".
   */
  private defaultOrganizationNameForNewUser(user: User): string {
    const parts = [user.firstName?.trim(), user.lastName?.trim()].filter(
      (p) => p && p.length > 0,
    );
    if (parts.length > 0) {
      return parts.join(' ').trim().slice(0, 200);
    }
    const local = user.email?.split('@')[0]?.trim();
    if (local && local.length > 0) {
      return local.slice(0, 200);
    }
    return 'My organization';
  }

  async listMine(userId: number): Promise<OrganizationPublicDto[]> {
    await this.ensureAtLeastOneOwnedOrganizationForUser(userId);
    const rows = await this.repo.listOrganizationsForUser(userId);
    return Promise.all(
      rows.map(async (o) => {
        const memberCount = await this.repo.countMembershipsForOrganization(o.id);
        const m = await this.repo.findMembership(userId, o.id);
        const isOwner = m?.role === ORGANIZATION_MEMBER_ROLE.OWNER;
        return this.toPublicDto(o, isOwner, memberCount, m);
      }),
    );
  }

  /** Stable tenant fallback when a resource has no `organization_id` (legacy rows). */
  async getFirstOrganizationInternalIdForUser(
    userId: number,
  ): Promise<number | null> {
    const rows = await this.repo.listOrganizationsForUser(userId);
    return rows[0]?.id ?? null;
  }

  async updateOrganization(
    ctx: OrganizationMemberContext,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationPublicDto> {
    if (!ctx.actingIsOwner) {
      throw new ForbiddenException(
        'Only organization owners can update organization settings.',
      );
    }
    const name = this.sanitizeCreateName(dto);
    const orgRow = await this.repo.findById(ctx.internalId);
    if (!orgRow) throw new NotFoundException('Organization not found');
    const previousName = orgRow.name;
    orgRow.name = name;
    await this.repo.saveOrganization(orgRow);
    const prevT = previousName.trim();
    const nextT = name.trim();
    const organizationUpdateTarget =
      prevT === nextT
        ? nextT
        : `${nextT} (was: ${prevT})`.slice(0, 400);
    await this.appendOrganizationAuditEvent(ctx.internalId, ctx.actingUserId, 'org.updated', {
      metadata: {
        endpoint: `PATCH /api/organizations/${encodeURIComponent(ctx.publicId)}`,
        organizationPublicId: ctx.publicId,
        organizationUpdateTarget,
        previousName,
        name,
      },
    });
    const memberCount = await this.repo.countMembershipsForOrganization(ctx.internalId);
    const nextCtx: OrganizationMemberContext = { ...ctx, name };
    return this.memberContextToPublicDto(nextCtx, memberCount);
  }

  /**
   * Organization owners may restrict workspace areas for non-owner members.
   * Use `permissions: { cron_jobs: false }` to block; `cron_jobs: true` clears a block.
   */
  async setMemberWorkspacePermissions(
    ctx: OrganizationMemberContext,
    rawEmail: string,
    permissions: Record<string, unknown>,
  ): Promise<{ message: string }> {
    if (!ctx.actingIsOwner) {
      throw new ForbiddenException(
        'Only organization owners can change member workspace permissions.',
      );
    }
    const email = String(rawEmail ?? '')
      .trim()
      .toLowerCase();
    if (!email) {
      throw new BadRequestException('email is required');
    }
    const target = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .getOne();
    if (!target) {
      throw new NotFoundException('No user with this email was found.');
    }
    const membership = await this.repo.findMembership(target.id, ctx.internalId);
    if (!membership) {
      throw new BadRequestException(
        'That user is not a member of this organization.',
      );
    }
    if (membership.role === ORGANIZATION_MEMBER_ROLE.OWNER) {
      throw new BadRequestException(
        'Organization owners always have full workspace access.',
      );
    }
    const patch: Partial<Record<OrganizationWorkspacePermission, boolean>> = {};
    if (permissions != null && typeof permissions === 'object') {
      for (const [k, v] of Object.entries(permissions)) {
        if (typeof v !== 'boolean') {
          throw new BadRequestException(
            `Permission "${k}" must be a boolean.`,
          );
        }
        if (!isOrganizationWorkspacePermission(k)) {
          throw new BadRequestException(`Unknown permission key: ${k}`);
        }
        patch[k as OrganizationWorkspacePermission] = v;
      }
    }
    const next = mergeWorkspacePermissionPatch(membership.permissions, patch);
    const n = await this.repo.updateMembershipPermissions(
      target.id,
      ctx.internalId,
      next,
    );
    if (n === 0) {
      throw new NotFoundException('Organization membership not found');
    }
    await this.appendOrganizationAuditEvent(
      ctx.internalId,
      ctx.actingUserId,
      'member.permissions_updated',
      {
        metadata: {
          endpoint: `PATCH /api/organizations/${encodeURIComponent(ctx.publicId)}/members/permissions`,
          patch,
          targetEmail: email,
        },
      },
    );
    return { message: 'Member workspace permissions updated.' };
  }

  /**
   * List/detail rows for org servers (Servers + Domains UIs): allow if `remote_server` or `domains`
   * is not blocked.
   */
  async assertMemberCanAccessOrgServerRow(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (!membershipHasOrgServerAccess(m)) {
      throw new ForbiddenException(
        'You do not have access to organization servers.',
      );
    }
  }

  /**
   * Strict access gate for Remote Servers workspace pages/routes.
   * Unlike server-row visibility used by Domains UI, this requires explicit
   * `remote_server` workspace access.
   */
  async assertMemberCanAccessOrgRemoteServersWorkspace(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER,
      )
    ) {
      throw new ForbiddenException(
        'You do not have access to organization remote servers.',
      );
    }
  }

  async assertMemberCanViewOrgProject(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS_VIEW,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to view this organization project.',
      );
    }
  }

  async assertMemberCanEditOrgProject(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS_VIEW,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to update this organization project.',
      );
    }
  }

  async assertMemberCanAddOrgProject(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS_ADD,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to create projects in this organization.',
      );
    }
  }

  async assertMemberCanDeleteOrgProject(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS_DELETE,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to delete projects in this organization.',
      );
    }
  }

  async assertMemberCanTestOrgRemoteServers(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TEST,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to run connection tests for organization remote servers.',
      );
    }
  }

  async assertMemberCanAddOrgRemoteServer(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_ADD,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to add organization remote servers.',
      );
    }
  }

  /** Update host row fields (not domains-only JSON — see {@link assertMemberCanEditOrgServerDomainsJson}). */
  async assertMemberCanEditOrgRemoteServerRow(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_EDIT,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to edit organization remote server settings.',
      );
    }
  }

  async assertMemberCanDeleteOrgRemoteServer(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DELETE,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to delete organization remote servers.',
      );
    }
  }

  /** Provision / install queues, presigned URL probes on host, notification send via deploy host. */
  async assertMemberCanInstallMaintainOrgRemoteServers(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_INSTALL_MAINTENANCE,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to run install or maintenance actions on organization remote servers.',
      );
    }
  }

  async assertMemberCanUseOrgRemoteTerminal(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL,
      )
    ) {
      throw new ForbiddenException(
        'You do not have access to the remote SSH terminal for this organization.',
      );
    }
  }

  async assertMemberCanUseOrgRemoteDockerManager(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER,
      )
    ) {
      throw new ForbiddenException(
        'You do not have access to Docker Manager for this organization.',
      );
    }
  }

  /**
   * PATCH remote server with only `domainsJson` (Domains UI): allow members with `domains` who can
   * see the server row, or anyone who can manage remote servers.
   */
  async assertMemberCanEditOrgDomainsCertificateEmail(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS_CERTIFICATE_EMAIL,
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to change certificate email for this organization workspace.',
      );
    }
  }

  async assertMemberCanEditOrgServerDomainsJson(
    userId: number,
    organizationInternalId: number,
  ): Promise<void> {
    const m = await this.repo.findMembership(userId, organizationInternalId);
    if (!m) throw new NotFoundException('Organization not found');
    if (!membershipHasOrgServerAccess(m)) {
      throw new ForbiddenException(
        'You do not have access to organization servers.',
      );
    }
    if (
      membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER,
      )
    ) {
      return;
    }
    if (
      membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS,
      ) &&
      membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS_ADD,
      )
    ) {
      return;
    }
    throw new ForbiddenException(
      'You do not have permission to edit domain hostnames for organization servers.',
    );
  }

  /**
   * Permanently removes all org-scoped workspace rows, then memberships and the organization.
   * Used when the sole member (owner) leaves: no resource transfer to another organization.
   */
  private async deleteOrganizationAndScopedResources(
    organizationId: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.delete(OrganizationAuditLog, { organizationId });
      await em.delete(Webhook, { organizationId });
      await em.delete(CronJob, { organizationId });
      await em.delete(TraefikSettings, { organizationId });
      await em.delete(Project, { organizationId });
      await em.delete(NotificationChannel, { organizationId });
      await em.delete(S3Profile, { organizationId });

      await em.delete(RemoteServerProvisionJob, { organizationId });
      await em.delete(RemoteServer, { organizationId });
      await em.delete(OrganizationMembership, { organizationId });
      await em.delete(Organization, { id: organizationId });
    });
  }

  /**
   * Same rules as {@link leaveOrganization}, but `accountDeletion` skips the
   * “keep at least one owned organization” check (user is deleting their account).
   */
  private async leaveOrganizationAsUser(
    userId: number,
    organizationInternalId: number,
    options: { accountDeletion: boolean },
  ): Promise<
    | 'member_left'
    | 'org_dissolved'
    | 'owner_left_multi'
    | 'owner_promoted_successor'
  > {
    const membership = await this.repo.findMembership(
      userId,
      organizationInternalId,
    );
    if (!membership) {
      throw new NotFoundException('Organization not found');
    }

    const orgPublicIdForAudit =
      await this.getPublicIdByInternalId(organizationInternalId);
    const memberLeftEndpoint =
      orgPublicIdForAudit != null && orgPublicIdForAudit.trim() !== ''
        ? `DELETE /api/organizations/${encodeURIComponent(orgPublicIdForAudit)}/membership`
        : 'DELETE /api/organizations/:publicId/membership';

    const actingIsOwner = membership.role === ORGANIZATION_MEMBER_ROLE.OWNER;

    if (!actingIsOwner) {
      await this.appendOrganizationAuditEvent(organizationInternalId, userId, 'member.left', {
        metadata: {
          endpoint: memberLeftEndpoint,
          memberLeftSummary: options.accountDeletion
            ? 'Left as member (account deletion)'
            : 'Left as member',
          ...(orgPublicIdForAudit != null && orgPublicIdForAudit.trim() !== ''
            ? { organizationPublicId: orgPublicIdForAudit }
            : {}),
          role: 'member',
          ...(options.accountDeletion ? { accountDeletion: true } : {}),
        },
      });
      const n = await this.repo.deleteMembership(userId, organizationInternalId);
      if (n === 0) {
        throw new NotFoundException('Organization not found');
      }
      return 'member_left';
    }

    const links = await this.repo.listMembershipsForOrganization(
      organizationInternalId,
    );
    if (links.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    if (links.length === 1) {
      if (!options.accountDeletion) {
        await this.assertKeepsAtLeastOneOwnedOrganizationAfterLosingOwnerHere(
          userId,
          organizationInternalId,
        );
      }
      await this.deleteOrganizationAndScopedResources(organizationInternalId);
      return 'org_dissolved';
    }

    if (!options.accountDeletion) {
      await this.assertKeepsAtLeastOneOwnedOrganizationAfterLosingOwnerHere(
        userId,
        organizationInternalId,
      );
    }

    const ownerCount = await this.repo.countOwnersForOrganization(
      organizationInternalId,
    );

    if (ownerCount > 1) {
      const ro = ownerCount - 1;
      await this.appendOrganizationAuditEvent(organizationInternalId, userId, 'member.left', {
        metadata: {
          endpoint: memberLeftEndpoint,
          memberLeftSummary: options.accountDeletion
            ? `Owner left; ${ro} owner(s) remain (account deletion)`
            : `Owner left; ${ro} owner(s) remain`,
          ...(orgPublicIdForAudit != null && orgPublicIdForAudit.trim() !== ''
            ? { organizationPublicId: orgPublicIdForAudit }
            : {}),
          wasOwner: true,
          remainingOwners: ro,
          ...(options.accountDeletion ? { accountDeletion: true } : {}),
        },
      });
      const n = await this.repo.deleteMembership(userId, organizationInternalId);
      if (n === 0) {
        throw new NotFoundException('Organization not found');
      }
      await this.syncLegacyOwnerIdColumn(organizationInternalId);
      return 'owner_left_multi';
    }

    const successor = links.find((l) => l.userId !== userId);
    if (!successor) {
      throw new ConflictException(
        'Cannot leave: no other member to transfer ownership to.',
      );
    }

    await this.repo.updateMembershipRole(
      successor.userId,
      organizationInternalId,
      ORGANIZATION_MEMBER_ROLE.OWNER,
    );
    await this.syncLegacyOwnerIdColumn(organizationInternalId);

    const successorUser = await this.users.findOne({
      where: { id: successor.userId },
    });
    const succEmail = successorUser?.email?.trim() ?? '';
    await this.appendOrganizationAuditEvent(organizationInternalId, userId, 'member.left', {
      metadata: {
        endpoint: memberLeftEndpoint,
        memberLeftSummary:
          succEmail !== ''
            ? options.accountDeletion
              ? `Owner left; ownership transferred to ${succEmail} (account deletion)`
              : `Owner left; ownership transferred to ${succEmail}`
            : options.accountDeletion
              ? 'Owner left; ownership transferred (account deletion)'
              : 'Owner left; ownership transferred',
        ...(orgPublicIdForAudit != null && orgPublicIdForAudit.trim() !== ''
          ? { organizationPublicId: orgPublicIdForAudit }
          : {}),
        wasOwner: true,
        promotedNewOwnerEmail: succEmail !== '' ? succEmail : null,
        ...(options.accountDeletion ? { accountDeletion: true } : {}),
      },
    });

    const n = await this.repo.deleteMembership(userId, organizationInternalId);
    if (n === 0) {
      throw new NotFoundException('Organization not found');
    }
    return 'owner_promoted_successor';
  }

  /**
   * Removes the user from every organization using the same semantics as leaving:
   * promote a successor or dissolve the org when they were the only member.
   * Skips the “must keep one owned org” rule — used only for account deletion.
   */
  async removeUserFromAllOrganizationsForAccountDeletion(
    userId: number,
  ): Promise<void> {
    for (;;) {
      const links = await this.repo.listMembershipsForUser(userId);
      if (links.length === 0) {
        return;
      }
      const { organizationId } = links[0];
      await this.leaveOrganizationAsUser(userId, organizationId, {
        accountDeletion: true,
      });
    }
  }

  async leaveOrganization(
    ctx: OrganizationMemberContext,
    userId: number,
  ): Promise<{ message: string }> {
    const outcome = await this.leaveOrganizationAsUser(userId, ctx.internalId, {
      accountDeletion: false,
    });
    if (outcome === 'member_left') {
      return { message: 'You left the organization.' };
    }
    if (outcome === 'org_dissolved') {
      return {
        message:
          'You left and the organization was closed because you were the only member. All of its workspace data was permanently deleted.',
      };
    }
    if (outcome === 'owner_left_multi') {
      return { message: 'You left the organization.' };
    }
    return {
      message:
        'Another member was promoted to owner (by membership date). You left the organization.',
    };
  }

  /**
   * Owners may promote members to owner or demote owners to member (never the last owner).
   */
  async setMemberRole(
    ctx: OrganizationMemberContext,
    actingUserId: number,
    rawEmail: string,
    role: OrganizationMemberRole,
  ): Promise<{ message: string }> {
    if (!ctx.actingIsOwner) {
      throw new ForbiddenException(
        'Only organization owners can change member roles.',
      );
    }
    const email = String(rawEmail ?? '')
      .trim()
      .toLowerCase();
    if (!email) {
      throw new BadRequestException('email is required');
    }
    const target = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .getOne();
    if (!target) {
      throw new NotFoundException('No user with this email was found.');
    }
    if (role === ORGANIZATION_MEMBER_ROLE.OWNER && target.id === actingUserId) {
      throw new BadRequestException(
        'Another organization owner must grant you the owner role.',
      );
    }
    const membership = await this.repo.findMembership(target.id, ctx.internalId);
    if (!membership) {
      throw new BadRequestException(
        'That user is not a member of this organization.',
      );
    }
    if (
      role === ORGANIZATION_MEMBER_ROLE.OWNER &&
      membership.role === ORGANIZATION_MEMBER_ROLE.OWNER
    ) {
      throw new BadRequestException('That user is already an owner.');
    }
    if (
      role === ORGANIZATION_MEMBER_ROLE.MEMBER &&
      membership.role === ORGANIZATION_MEMBER_ROLE.MEMBER
    ) {
      throw new BadRequestException('That user is already a member.');
    }
    if (
      role === ORGANIZATION_MEMBER_ROLE.MEMBER &&
      membership.role === ORGANIZATION_MEMBER_ROLE.OWNER
    ) {
      const ownerCount = await this.repo.countOwnersForOrganization(ctx.internalId);
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Cannot remove the last owner. Promote another member to owner first.',
        );
      }
      await this.assertKeepsAtLeastOneOwnedOrganizationAfterLosingOwnerHere(
        target.id,
        ctx.internalId,
      );
    }

    const n = await this.repo.updateMembershipRole(
      target.id,
      ctx.internalId,
      role,
    );
    if (n === 0) {
      throw new NotFoundException('Organization membership not found');
    }
    await this.syncLegacyOwnerIdColumn(ctx.internalId);

    await this.appendOrganizationAuditEvent(
      ctx.internalId,
      actingUserId,
      'member.role_changed',
      {
        metadata: {
          endpoint: `PATCH /api/organizations/${encodeURIComponent(ctx.publicId)}/ownership`,
          newRole: role,
          targetEmail: email,
        },
      },
    );

    if (role === ORGANIZATION_MEMBER_ROLE.OWNER) {
      return { message: 'Member promoted to owner.' };
    }
    return { message: 'Owner role removed; user is now a member.' };
  }

  /**
   * Validates publicId, resolves org, verifies membership. Same 404 for unknown org and non-member.
   */
  async requireMemberContext(
    rawPublicId: unknown,
    userId: number,
    opts?: ResolveOrganizationWorkspaceOptions,
  ): Promise<OrganizationMemberContext> {
    const publicId = parseOrganizationPublicIdParam(rawPublicId);
    const org = await this.repo.findByPublicId(publicId);
    if (!org) throw new NotFoundException('Organization not found');
    const member = await this.repo.findMembership(userId, org.id);
    if (!member) throw new NotFoundException('Organization not found');
    const actingIsOwner = member.role === ORGANIZATION_MEMBER_ROLE.OWNER;
    if (opts?.requireWorkspaceArea) {
      if (
        !membershipAllowsWorkspaceArea(member, opts.requireWorkspaceArea)
      ) {
        throw new ForbiddenException(
          'You do not have access to this area of the organization workspace.',
        );
      }
    }
    for (const a of opts?.requireAllWorkspaceAreas ?? []) {
      if (!membershipAllowsWorkspaceArea(member, a)) {
        throw new ForbiddenException(
          'You do not have access to this area of the organization workspace.',
        );
      }
    }
    if (opts?.requireOrgServersAccess) {
      if (!membershipHasOrgServerAccess(member)) {
        throw new ForbiddenException(
          'You do not have access to organization servers or domains.',
        );
      }
    }
    if (
      opts?.requireAnyWorkspaceAreas != null &&
      opts.requireAnyWorkspaceAreas.length > 0
    ) {
      const ok = opts.requireAnyWorkspaceAreas.some((a) =>
        membershipAllowsWorkspaceArea(member, a),
      );
      if (!ok) {
        throw new ForbiddenException(
          'You do not have access to this area of the organization workspace.',
        );
      }
    }
    const workspacePermissions = effectiveWorkspacePermissions(member);
    return {
      internalId: org.id,
      publicId: org.publicId,
      name: org.name,
      ownerId: org.ownerId,
      createdAt: org.createdAt,
      actingUserId: userId,
      actingIsOwner,
      workspacePermissions,
    };
  }

  async listMembers(
    ctx: OrganizationMemberContext,
  ): Promise<OrganizationMemberPublicDto[]> {
    if (
      !ctx.actingIsOwner &&
      !ctx.workspacePermissions[
        ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS
      ] &&
      !ctx.workspacePermissions[
        ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS
      ]
    ) {
      throw new ForbiddenException(
        'You do not have permission to list organization members.',
      );
    }
    const links = await this.repo.listMembershipsForOrganization(ctx.internalId);
    if (links.length === 0) return [];
    const userIds = [...new Set(links.map((l) => l.userId))];
    const userRows = await this.users.find({ where: { id: In(userIds) } });
    const byId = new Map(userRows.map((u) => [u.id, u]));
    return links.map((link) => {
      const u = byId.get(link.userId);
      if (!u) {
        throw new NotFoundException('Organization member data is incomplete');
      }
      return {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        isOwner: link.role === ORGANIZATION_MEMBER_ROLE.OWNER,
        joinedAt: link.createdAt.toISOString(),
        workspacePermissions: effectiveWorkspacePermissions(link),
      };
    });
  }

  /**
   * Adds an existing user to an organization (e.g. after they accept an email invite).
   */
  async addMemberByUserId(
    organizationInternalId: number,
    userId: number,
  ): Promise<OrganizationMemberPublicDto> {
    const org = await this.repo.findById(organizationInternalId);
    if (!org) throw new NotFoundException('Organization not found');
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const existing = await this.repo.findMembership(user.id, organizationInternalId);
    if (existing) {
      throw new ConflictException('This user is already a member.');
    }
    const membership = new OrganizationMembership();
    membership.userId = user.id;
    membership.organizationId = organizationInternalId;
    const saved = await this.repo.saveMembership(membership);
    await this.appendOrganizationAuditEvent(
      organizationInternalId,
      userId,
      'member.joined',
      {
        metadata: {
          endpoint: 'POST /api/organizations/invitations/accept',
          organizationPublicId: org.publicId?.trim() || null,
          targetEmail: user.email.trim().toLowerCase(),
        },
      },
    );
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isOwner: saved.role === ORGANIZATION_MEMBER_ROLE.OWNER,
      joinedAt: saved.createdAt.toISOString(),
      workspacePermissions: effectiveWorkspacePermissions(saved),
    };
  }

  /** Resolve an organization's public id from its internal primary key (for API payloads). */
  async getPublicIdByInternalId(internalId: number): Promise<string | null> {
    if (!Number.isFinite(internalId) || internalId < 1) return null;
    const org = await this.repo.findById(Math.trunc(internalId));
    return org?.publicId ?? null;
  }

  async listProjectsForOrg(
    ctx: OrganizationMemberContext,
  ): Promise<OrganizationProjectPublicDto[]> {
    if (
      !ctx.workspacePermissions[ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS]
    ) {
      throw new ForbiddenException(
        'You do not have access to organization projects.',
      );
    }
    const rows = await this.projects.find({
      where: { organizationId: ctx.internalId },
      relations: ['services'],
      order: { createdAt: 'DESC' },
    });
    const out: OrganizationProjectPublicDto[] = [];
    for (const p of rows) {
      let row = p;
      if (!row.publicId) {
        row.publicId = generatePublicId('prj');
        row = await this.projects.save(row);
      }
      const services = row.services ?? [];
      out.push({
        publicId: row.publicId,
        name: row.name,
        description: row.description ?? '',
        createdAt: row.createdAt.toISOString(),
        serviceCount: services.length,
      });
    }
    return out;
  }
}
