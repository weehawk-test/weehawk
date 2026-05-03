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
  /**
   * Additional areas that must be allowed (e.g. sub-capabilities under the parent area).
   * Each is checked with {@link membershipAllowsWorkspaceArea}.
   */
  requireAllWorkspaceAreas?: OrganizationWorkspacePermission[];
  /** Remote servers / domains: at least one of those areas must be allowed. */
  requireOrgServersAccess?: boolean;
  /**
   * At least one of these workspace areas must be allowed (e.g. S3 add **or** edit for connection tests).
   */
  requireAnyWorkspaceAreas?: OrganizationWorkspacePermission[];
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

  const areasToCheck = new Set<OrganizationWorkspacePermission>();
  if (options?.requireWorkspaceArea) {
    areasToCheck.add(options.requireWorkspaceArea);
  }
  for (const a of options?.requireAllWorkspaceAreas ?? []) {
    areasToCheck.add(a);
  }
  for (const area of areasToCheck) {
    if (!membershipAllowsWorkspaceArea(m, area)) {
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
  if (
    options?.requireAnyWorkspaceAreas != null &&
    options.requireAnyWorkspaceAreas.length > 0
  ) {
    const ok = options.requireAnyWorkspaceAreas.some((a) =>
      membershipAllowsWorkspaceArea(m, a),
    );
    if (!ok) {
      throw new ForbiddenException(
        'You do not have access to this area of the organization workspace.',
      );
    }
  }

  return org.id;
}
