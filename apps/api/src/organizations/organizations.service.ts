import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
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
import { generatePublicId } from '../common/public-id';
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
    const memberCount = await this.repo.countMembershipsForOrganization(saved.id);
    return this.toPublicDto(saved, true, memberCount, membership);
  }

  async listMine(userId: number): Promise<OrganizationPublicDto[]> {
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

  async updateOrganization(
    ctx: OrganizationMemberContext,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationPublicDto> {
    if (
      !ctx.actingIsOwner &&
      !ctx.workspacePermissions[
        ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS
      ]
    ) {
      throw new ForbiddenException(
        'You do not have permission to update organization settings.',
      );
    }
    const name = this.sanitizeCreateName(dto);
    const orgRow = await this.repo.findById(ctx.internalId);
    if (!orgRow) throw new NotFoundException('Organization not found');
    orgRow.name = name;
    await this.repo.saveOrganization(orgRow);
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
    if (
      !ctx.actingIsOwner &&
      !ctx.workspacePermissions[
        ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS
      ]
    ) {
      throw new ForbiddenException(
        'You do not have permission to change member workspace permissions.',
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
   * Clears org scope on tenant rows, removes memberships, deletes the org row.
   * Used when the last member (owner) leaves.
   */
  private async dissolveOrganization(organizationId: number): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.update(Project, { organizationId }, { organizationId: null });
      await em.update(RemoteServer, { organizationId }, { organizationId: null });
      await em.update(Webhook, { organizationId }, { organizationId: null });
      await em.update(CronJob, { organizationId }, { organizationId: null });
      await em.update(NotificationChannel, { organizationId }, { organizationId: null });

      const s3Rows = await em.find(S3Profile, { where: { organizationId } });
      for (const row of s3Rows) {
        await em.update(
          S3Profile,
          { id: row.id },
          {
            organizationId: null,
            workspaceKey: `u:${row.userId}`,
          },
        );
      }

      await em.delete(OrganizationMembership, { organizationId });
      await em.delete(Organization, { id: organizationId });
    });
  }

  async leaveOrganization(
    ctx: OrganizationMemberContext,
    userId: number,
  ): Promise<{ message: string }> {
    if (!ctx.actingIsOwner) {
      const n = await this.repo.deleteMembership(userId, ctx.internalId);
      if (n === 0) {
        throw new NotFoundException('Organization not found');
      }
      return { message: 'You left the organization.' };
    }

    const links = await this.repo.listMembershipsForOrganization(ctx.internalId);
    if (links.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    if (links.length === 1) {
      await this.dissolveOrganization(ctx.internalId);
      return {
        message:
          'You left and the organization was closed because you were the only member. Its resources were moved to personal workspaces.',
      };
    }

    const ownerCount = await this.repo.countOwnersForOrganization(ctx.internalId);

    if (ownerCount > 1) {
      const n = await this.repo.deleteMembership(userId, ctx.internalId);
      if (n === 0) {
        throw new NotFoundException('Organization not found');
      }
      await this.syncLegacyOwnerIdColumn(ctx.internalId);
      return { message: 'You left the organization.' };
    }

    const successor = links.find((l) => l.userId !== userId);
    if (!successor) {
      throw new ConflictException(
        'Cannot leave: no other member to transfer ownership to.',
      );
    }

    await this.repo.updateMembershipRole(
      successor.userId,
      ctx.internalId,
      ORGANIZATION_MEMBER_ROLE.OWNER,
    );
    await this.syncLegacyOwnerIdColumn(ctx.internalId);

    const n = await this.repo.deleteMembership(userId, ctx.internalId);
    if (n === 0) {
      throw new NotFoundException('Organization not found');
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
    if (
      !ctx.actingIsOwner &&
      !ctx.workspacePermissions[
        ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS
      ]
    ) {
      throw new ForbiddenException(
        'You do not have permission to change member roles.',
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
