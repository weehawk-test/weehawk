import { ORGANIZATION_MEMBER_ROLE } from './organization-member-role';
import type { OrganizationMembership } from './entities/organization-membership.entity';

export const ORGANIZATION_WORKSPACE_PERMISSIONS = {
  PROJECTS: 'projects',
  REMOTE_SERVER: 'remote_server',
  /** Sub-capability: SSH terminal + SSH-only tests; requires {@link ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER}. */
  REMOTE_SERVER_TERMINAL: 'remote_server_terminal',
  /** Sub-capability: Docker Manager + Docker API tests/build; requires {@link ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER}. */
  REMOTE_SERVER_DOCKER_MANAGER: 'remote_server_docker_manager',
  DOMAINS: 'domains',
  WEBHOOKS: 'webhooks',
  CRON_JOBS: 'cron_jobs',
  NOTIFICATIONS: 'notifications',
  S3: 's3',
  REGISTRY: 'registry',
  GIT: 'git',
  ORGANIZATION_MANAGEMENT: 'organization_management',
} as const;

export type OrganizationWorkspacePermission =
  (typeof ORGANIZATION_WORKSPACE_PERMISSIONS)[keyof typeof ORGANIZATION_WORKSPACE_PERMISSIONS];

export const ALL_ORGANIZATION_WORKSPACE_PERMISSIONS = Object.values(
  ORGANIZATION_WORKSPACE_PERMISSIONS,
) as OrganizationWorkspacePermission[];

export function isOrganizationWorkspacePermission(
  raw: string,
): raw is OrganizationWorkspacePermission {
  return (ALL_ORGANIZATION_WORKSPACE_PERMISSIONS as string[]).includes(raw);
}

function isOwnerMembership(m: OrganizationMembership): boolean {
  return m.role === ORGANIZATION_MEMBER_ROLE.OWNER;
}

/** Stored JSON uses explicit `false` for blocked areas; missing keys mean allowed. */
export function membershipAllowsWorkspaceArea(
  m: OrganizationMembership,
  area: OrganizationWorkspacePermission,
): boolean {
  if (isOwnerMembership(m)) return true;

  if (area === ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL) {
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER,
      )
    ) {
      return false;
    }
    const pt = m.permissions;
    if (
      pt != null &&
      typeof pt === 'object' &&
      Object.prototype.hasOwnProperty.call(pt, area) &&
      pt[area] === false
    ) {
      return false;
    }
    return true;
  }

  if (area === ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER) {
    if (
      !membershipAllowsWorkspaceArea(
        m,
        ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER,
      )
    ) {
      return false;
    }
    const pd = m.permissions;
    if (
      pd != null &&
      typeof pd === 'object' &&
      Object.prototype.hasOwnProperty.call(pd, area) &&
      pd[area] === false
    ) {
      return false;
    }
    return true;
  }

  const p = m.permissions;
  if (p == null || typeof p !== 'object') return true;
  if (Object.prototype.hasOwnProperty.call(p, area) && p[area] === false) {
    return false;
  }
  return true;
}

/**
 * Org remote-server **list** API (Servers + Domains UIs both need the host list): allow if either
 * `remote_server` or `domains` is not blocked. Managing a single server (SSH, save, delete) uses
 * {@link membershipAllowsWorkspaceArea} with `remote_server` only.
 */
export function membershipHasOrgServerAccess(m: OrganizationMembership): boolean {
  if (isOwnerMembership(m)) return true;
  return (
    membershipAllowsWorkspaceArea(m, ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER) ||
    membershipAllowsWorkspaceArea(m, ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS)
  );
}

export function effectiveWorkspacePermissions(
  m: OrganizationMembership,
): Record<OrganizationWorkspacePermission, boolean> {
  const out = {} as Record<OrganizationWorkspacePermission, boolean>;
  for (const key of ALL_ORGANIZATION_WORKSPACE_PERMISSIONS) {
    out[key] = membershipAllowsWorkspaceArea(m, key);
  }
  return out;
}

export function allWorkspacePermissionsAllowed(): Record<
  OrganizationWorkspacePermission,
  boolean
> {
  const out = {} as Record<OrganizationWorkspacePermission, boolean>;
  for (const key of ALL_ORGANIZATION_WORKSPACE_PERMISSIONS) {
    out[key] = true;
  }
  return out;
}

/** Merge owner updates: `true` removes a deny; `false` adds a deny. */
export function mergeWorkspacePermissionPatch(
  existing: Record<string, boolean> | null | undefined,
  patch: Partial<Record<OrganizationWorkspacePermission, boolean>>,
): Record<string, boolean> | null {
  const base =
    existing != null && typeof existing === 'object'
      ? { ...existing }
      : ({} as Record<string, boolean>);
  for (const [rawKey, value] of Object.entries(patch)) {
    if (!isOrganizationWorkspacePermission(rawKey)) continue;
    if (value === true) {
      delete base[rawKey];
    } else if (value === false) {
      base[rawKey] = false;
    }
  }
  const keys = Object.keys(base);
  return keys.length === 0 ? null : base;
}
