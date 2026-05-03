import { ORGANIZATION_MEMBER_ROLE } from './organization-member-role';
import type { OrganizationMembership } from './entities/organization-membership.entity';

export const ORGANIZATION_WORKSPACE_PERMISSIONS = {
  PROJECTS: 'projects',
  /** Sub-capability: open project detail and services (GET/PATCH project). */
  PROJECTS_VIEW: 'projects_view',
  /** Sub-capability: create projects in the organization. */
  PROJECTS_ADD: 'projects_add',
  /** Sub-capability: delete organization projects (no services). */
  PROJECTS_DELETE: 'projects_delete',
  REMOTE_SERVER: 'remote_server',
  /** Sub-capability: SSH terminal; requires {@link ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER}. */
  REMOTE_SERVER_TERMINAL: 'remote_server_terminal',
  /** Sub-capability: Docker Manager + remote Docker builds; requires {@link ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER}. */
  REMOTE_SERVER_DOCKER_MANAGER: 'remote_server_docker_manager',
  /** Sub-capability: SSH / Docker connection tests; requires terminal and/or Docker sub-cap as applicable. */
  REMOTE_SERVER_TEST: 'remote_server_test',
  /** Sub-capability: add new host rows to the organization. */
  REMOTE_SERVER_ADD: 'remote_server_add',
  /** Sub-capability: update host rows (not domains-only JSON edits). */
  REMOTE_SERVER_EDIT: 'remote_server_edit',
  /** Sub-capability: delete host rows. */
  REMOTE_SERVER_DELETE: 'remote_server_delete',
  /** Sub-capability: provision scripts, install queues, presigned probes, deploy-host notification delivery. */
  REMOTE_SERVER_INSTALL_MAINTENANCE: 'remote_server_install_maintenance',
  DOMAINS: 'domains',
  /** Sub-capability: change Let's Encrypt / ACME contact email (Traefik) from org Domains UI. */
  DOMAINS_CERTIFICATE_EMAIL: 'domains_certificate_email',
  /** Sub-capability: edit site hostnames (`domainsJson`) on deploy servers. */
  DOMAINS_ADD: 'domains_add',
  WEBHOOKS: 'webhooks',
  /** Sub-capability: create webhooks in the organization workspace. */
  WEBHOOKS_ADD: 'webhooks_add',
  /** Sub-capability: update existing webhooks. */
  WEBHOOKS_EDIT: 'webhooks_edit',
  /** Sub-capability: read last-run logs for webhooks. */
  WEBHOOKS_LOGS: 'webhooks_logs',
  /** Sub-capability: run / trigger webhooks from the UI (remote agent). */
  WEBHOOKS_RUN: 'webhooks_run',
  /** Sub-capability: delete webhooks. */
  WEBHOOKS_DELETE: 'webhooks_delete',
  CRON_JOBS: 'cron_jobs',
  /** Sub-capability: create cron jobs in the organization workspace. */
  CRON_JOBS_ADD: 'cron_jobs_add',
  /** Sub-capability: update cron jobs (including pause/resume). */
  CRON_JOBS_EDIT: 'cron_jobs_edit',
  /** Sub-capability: read last-run logs for cron jobs. */
  CRON_JOBS_LOGS: 'cron_jobs_logs',
  /** Sub-capability: run a cron job on demand. */
  CRON_JOBS_RUN: 'cron_jobs_run',
  /** Sub-capability: delete cron jobs. */
  CRON_JOBS_DELETE: 'cron_jobs_delete',
  NOTIFICATIONS: 'notifications',
  /** Sub-capability: create notification channels in the organization workspace. */
  NOTIFICATIONS_ADD: 'notifications_add',
  /** Sub-capability: update or delete notification channels. */
  NOTIFICATIONS_EDIT: 'notifications_edit',
  /** Sub-capability: run test sends for notification channels. */
  NOTIFICATIONS_TEST: 'notifications_test',
  S3: 's3',
  /** Sub-capability: list profiles and browse bucket objects (read / list / download). */
  S3_BROWSE: 's3_browse',
  /** Sub-capability: create profiles and upload objects / folders. */
  S3_ADD: 's3_add',
  /** Sub-capability: update or delete profiles and delete bucket objects. */
  S3_EDIT: 's3_edit',
  REGISTRY: 'registry',
  GIT: 'git',
  ORGANIZATION_MANAGEMENT: 'organization_management',
  /** Sub-capability: organization management · Overview tab. */
  ORGANIZATION_MANAGEMENT_OVERVIEW: 'organization_management_overview',
  /** Sub-capability: organization management · Audit log tab. */
  ORGANIZATION_MANAGEMENT_AUDIT_LOG: 'organization_management_audit_log',
  /** Sub-capability: organization management · Members tab (list; invites remain owner-only). */
  ORGANIZATION_MANAGEMENT_MEMBERS: 'organization_management_members',
  /** Sub-capability: organization management · Permission matrix tab (editing remains owner-only). */
  ORGANIZATION_MANAGEMENT_PERMISSIONS: 'organization_management_permissions',
  /** Sub-capability: organization management · Settings tab (e.g. display name when allowed). */
  ORGANIZATION_MANAGEMENT_SETTINGS: 'organization_management_settings',
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

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER}; each can be denied independently. */
export const ORGANIZATION_REMOTE_SERVER_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] =
  [
    ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL,
    ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER,
    ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TEST,
    ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_ADD,
    ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_EDIT,
    ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DELETE,
    ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER_INSTALL_MAINTENANCE,
  ];

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS}. */
export const ORGANIZATION_PROJECTS_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] =
  [
    ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS_VIEW,
    ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS_ADD,
    ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS_DELETE,
  ];

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS}. */
export const ORGANIZATION_DOMAINS_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] =
  [
    ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS_CERTIFICATE_EMAIL,
    ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS_ADD,
  ];

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS}. */
export const ORGANIZATION_WEBHOOKS_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] =
  [
    ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_ADD,
    ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_EDIT,
    ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_LOGS,
    ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_RUN,
    ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_DELETE,
  ];

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS}. */
export const ORGANIZATION_CRON_JOBS_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] =
  [
    ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS_ADD,
    ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS_EDIT,
    ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS_LOGS,
    ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS_RUN,
    ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS_DELETE,
  ];

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS}. */
export const ORGANIZATION_NOTIFICATIONS_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] =
  [
    ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_ADD,
    ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT,
    ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS_TEST,
  ];

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.S3}. */
export const ORGANIZATION_S3_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] = [
  ORGANIZATION_WORKSPACE_PERMISSIONS.S3_BROWSE,
  ORGANIZATION_WORKSPACE_PERMISSIONS.S3_ADD,
  ORGANIZATION_WORKSPACE_PERMISSIONS.S3_EDIT,
];

/** Sub-capabilities under {@link ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT}. */
export const ORGANIZATION_MANAGEMENT_SUB_PERMISSIONS: readonly OrganizationWorkspacePermission[] =
  [
    ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW,
    ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG,
    ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS,
    ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS,
    ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS,
  ];

const PARENT_BY_SUB_WORKSPACE_PERMISSION = new Map<
  OrganizationWorkspacePermission,
  OrganizationWorkspacePermission
>([
  ...ORGANIZATION_REMOTE_SERVER_SUB_PERMISSIONS.map(
    (k) =>
      [k, ORGANIZATION_WORKSPACE_PERMISSIONS.REMOTE_SERVER] as const,
  ),
  ...ORGANIZATION_PROJECTS_SUB_PERMISSIONS.map(
    (k) => [k, ORGANIZATION_WORKSPACE_PERMISSIONS.PROJECTS] as const,
  ),
  ...ORGANIZATION_DOMAINS_SUB_PERMISSIONS.map(
    (k) => [k, ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS] as const,
  ),
  ...ORGANIZATION_WEBHOOKS_SUB_PERMISSIONS.map(
    (k) => [k, ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS] as const,
  ),
  ...ORGANIZATION_CRON_JOBS_SUB_PERMISSIONS.map(
    (k) => [k, ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS] as const,
  ),
  ...ORGANIZATION_NOTIFICATIONS_SUB_PERMISSIONS.map(
    (k) => [k, ORGANIZATION_WORKSPACE_PERMISSIONS.NOTIFICATIONS] as const,
  ),
  ...ORGANIZATION_S3_SUB_PERMISSIONS.map(
    (k) => [k, ORGANIZATION_WORKSPACE_PERMISSIONS.S3] as const,
  ),
  ...ORGANIZATION_MANAGEMENT_SUB_PERMISSIONS.map(
    (k) =>
      [k, ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT] as const,
  ),
]);

function isOwnerMembership(m: OrganizationMembership): boolean {
  return m.role === ORGANIZATION_MEMBER_ROLE.OWNER;
}

/** Stored JSON uses explicit `false` for blocked areas; missing keys mean allowed. */
export function membershipAllowsWorkspaceArea(
  m: OrganizationMembership,
  area: OrganizationWorkspacePermission,
): boolean {
  if (isOwnerMembership(m)) return true;

  const subParent = PARENT_BY_SUB_WORKSPACE_PERMISSION.get(area);
  if (subParent !== undefined) {
    if (!membershipAllowsWorkspaceArea(m, subParent)) {
      return false;
    }
    const sub = m.permissions;
    if (
      sub != null &&
      typeof sub === 'object' &&
      Object.prototype.hasOwnProperty.call(sub, area) &&
      sub[area] === false
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
