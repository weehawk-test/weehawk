import type { OrganizationWorkspacePermissions } from "./org-workspace-permissions";

export type OrganizationPublic = {
  publicId: string;
  name: string;
  isOwner: boolean;
  createdAt: string;
  /** Total members; from API for leave/owner messaging. */
  memberCount: number;
  /** Effective workspace areas for the signed-in member. */
  workspacePermissions: OrganizationWorkspacePermissions;
};

export type CreateOrganizationInput = {
  name: string;
};

export type UpdateOrganizationInput = {
  name: string;
};

export type OrganizationMemberPublic = {
  email: string;
  firstName: string;
  lastName: string;
  isOwner: boolean;
  joinedAt: string;
  workspacePermissions: OrganizationWorkspacePermissions;
};

/** Response from POST /api/organizations/invitations/accept */
export type OrganizationInviteAcceptResult = OrganizationMemberPublic & {
  organizationPublicId: string;
  organizationName: string;
};

export type OrganizationProjectListItem = {
  publicId: string;
  name: string;
  description: string;
  createdAt: string;
  serviceCount: number;
};

export type OrganizationAuditLogEntry = {
  id: number;
  action: string;
  createdAt: string;
  actorUserId: number;
  actorEmail: string;
  metadata: Record<string, unknown> | null;
};

export type OrganizationAuditLogPage = {
  items: OrganizationAuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
