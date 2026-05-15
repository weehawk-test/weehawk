import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { ORGANIZATION_MEMBER_ROLE } from '../../organizations/organization-member-role';
import {
  isOrganizationWorkspacePermission,
  mergeWorkspacePermissionPatch,
  type OrganizationWorkspacePermission,
} from '../../organizations/organization-workspace-permissions';
import type { OrganizationMemberContext } from '../../organizations/organization-member-context';
import { OrganizationAuditService } from '../audit/organization-audit.service';
import { EnterpriseLicenseService } from '../license-token';

@Injectable()
export class OrganizationPermissionsService {
  constructor(
    private readonly repo: OrganizationsRepository,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly enterpriseLicense: EnterpriseLicenseService,
  ) {}

  /**
   * Organization owners may restrict workspace areas for non-owner members.
   * Use `permissions: { cron_jobs: false }` to block; `cron_jobs: true` clears a block.
   */
  async setMemberWorkspacePermissions(
    ctx: OrganizationMemberContext,
    rawEmail: string,
    permissions: Record<string, unknown>,
  ): Promise<{ message: string }> {
    if (!this.enterpriseLicense.isLicensed()) {
      throw new ForbiddenException({
        message:
          'Enterprise license required to change member workspace permissions.',
        code: 'ENTERPRISE_LICENSE_REQUIRED',
        salesUrl: this.enterpriseLicense.getSalesUrl(),
      });
    }
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
    await this.organizationAuditService.appendOrganizationAuditEvent(
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
}
