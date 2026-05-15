import type { OrganizationWorkspacePermission } from './organization-workspace-permissions';

export type OrganizationMemberContext = {
  internalId: number;
  publicId: string;
  name: string;
  /** Legacy column; kept in sync with membership roles for older code paths. */
  ownerId: number;
  createdAt: Date;
  /** Session user whose membership was resolved for this request. */
  actingUserId: number;
  /** True when the acting user's membership role is owner. */
  actingIsOwner: boolean;
  workspacePermissions: Record<OrganizationWorkspacePermission, boolean>;
};
