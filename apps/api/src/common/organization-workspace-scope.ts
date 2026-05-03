import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import {
  membershipAllowsWorkspaceArea,
  membershipHasOrgServerAccess,
  type OrganizationWorkspacePermission,
} from '../organizations/organization-workspace-permissions';

export type ResolveOrganizationWorkspaceOptions = {
  /** Require access to this workspace area (non-owners). */
  requireWorkspaceArea?: OrganizationWorkspacePermission;
  /** Remote servers / domains: at least one of those areas must be allowed. */
  requireOrgServersAccess?: boolean;
};

/**
 * Resolves an organization the user is a member of, or `null` for the personal workspace.
 */
export async function resolveOrganizationInternalIdForMember(
  organizations: OrganizationsRepository,
  userId: number,
  organizationPublicId: string | null | undefined,
  options?: ResolveOrganizationWorkspaceOptions,
): Promise<number | null> {
  const raw = organizationPublicId?.trim();
  if (!raw) return null;
  const org = await organizations.findByPublicId(raw);
  if (!org) throw new NotFoundException('Organization not found');
  const m = await organizations.findMembership(userId, org.id);
  if (!m) throw new NotFoundException('Organization not found');

  if (options?.requireWorkspaceArea) {
    if (!membershipAllowsWorkspaceArea(m, options.requireWorkspaceArea)) {
      throw new ForbiddenException(
        'You do not have access to this area of the organization workspace.',
      );
    }
  }
  if (options?.requireOrgServersAccess) {
    if (!membershipHasOrgServerAccess(m)) {
      throw new ForbiddenException(
        'You do not have access to organization servers or domains.',
      );
    }
  }

  return org.id;
}
