/** Mirrors API `ORGANIZATION_WORKSPACE_PERMISSIONS` for UI and routing. */
export const ORG_WORKSPACE_PERMISSIONS = {
  PROJECTS: "projects",
  PROJECTS_VIEW: "projects_view",
  PROJECTS_ADD: "projects_add",
  PROJECTS_DELETE: "projects_delete",
  REMOTE_SERVER: "remote_server",
  REMOTE_SERVER_TERMINAL: "remote_server_terminal",
  REMOTE_SERVER_DOCKER_MANAGER: "remote_server_docker_manager",
  REMOTE_SERVER_TEST: "remote_server_test",
  REMOTE_SERVER_ADD: "remote_server_add",
  REMOTE_SERVER_EDIT: "remote_server_edit",
  REMOTE_SERVER_DELETE: "remote_server_delete",
  REMOTE_SERVER_INSTALL_MAINTENANCE: "remote_server_install_maintenance",
  DOMAINS: "domains",
  DOMAINS_CERTIFICATE_EMAIL: "domains_certificate_email",
  DOMAINS_ADD: "domains_add",
  WEBHOOKS: "webhooks",
  WEBHOOKS_ADD: "webhooks_add",
  WEBHOOKS_EDIT: "webhooks_edit",
  WEBHOOKS_LOGS: "webhooks_logs",
  WEBHOOKS_RUN: "webhooks_run",
  WEBHOOKS_DELETE: "webhooks_delete",
  CRON_JOBS: "cron_jobs",
  CRON_JOBS_ADD: "cron_jobs_add",
  CRON_JOBS_EDIT: "cron_jobs_edit",
  CRON_JOBS_LOGS: "cron_jobs_logs",
  CRON_JOBS_RUN: "cron_jobs_run",
  CRON_JOBS_DELETE: "cron_jobs_delete",
  NOTIFICATIONS: "notifications",
  NOTIFICATIONS_ADD: "notifications_add",
  NOTIFICATIONS_EDIT: "notifications_edit",
  NOTIFICATIONS_TEST: "notifications_test",
  S3: "s3",
  S3_BROWSE: "s3_browse",
  S3_ADD: "s3_add",
  S3_EDIT: "s3_edit",
  REGISTRY: "registry",
  GIT: "git",
  ORGANIZATION_MANAGEMENT: "organization_management",
  ORGANIZATION_MANAGEMENT_OVERVIEW: "organization_management_overview",
  ORGANIZATION_MANAGEMENT_AUDIT_LOG: "organization_management_audit_log",
  ORGANIZATION_MANAGEMENT_MEMBERS: "organization_management_members",
  ORGANIZATION_MANAGEMENT_PERMISSIONS: "organization_management_permissions",
  ORGANIZATION_MANAGEMENT_SETTINGS: "organization_management_settings",
} as const;

export type OrgWorkspacePermissionKey =
  (typeof ORG_WORKSPACE_PERMISSIONS)[keyof typeof ORG_WORKSPACE_PERMISSIONS];

export const ALL_ORG_WORKSPACE_PERMISSION_KEYS = Object.values(
  ORG_WORKSPACE_PERMISSIONS,
) as OrgWorkspacePermissionKey[];

/** Keys shown under Projects → Advanced (not separate table columns). */
export const ORG_PROJECTS_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.PROJECTS_VIEW,
  ORG_WORKSPACE_PERMISSIONS.PROJECTS_ADD,
  ORG_WORKSPACE_PERMISSIONS.PROJECTS_DELETE,
];

/** Keys shown under Servers → Advanced (not separate table columns). */
export const ORG_REMOTE_SERVER_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TEST,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_ADD,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_EDIT,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DELETE,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_INSTALL_MAINTENANCE,
];

/** Keys shown under Domains → Advanced (not separate table columns). */
export const ORG_DOMAINS_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.DOMAINS_CERTIFICATE_EMAIL,
  ORG_WORKSPACE_PERMISSIONS.DOMAINS_ADD,
];

/** Keys shown under Webhooks → Advanced (not separate table columns). */
export const ORG_WEBHOOKS_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_ADD,
  ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_EDIT,
  ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_LOGS,
  ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_RUN,
  ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_DELETE,
];

/** Keys shown under Cron jobs → Advanced (not separate table columns). */
export const ORG_CRON_JOBS_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_ADD,
  ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_EDIT,
  ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_LOGS,
  ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_RUN,
  ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_DELETE,
];

/** Keys shown under Notifications → Advanced (not separate table columns). */
export const ORG_NOTIFICATIONS_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_ADD,
  ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT,
  ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_TEST,
];

/** Keys shown under S3 → Advanced (not separate table columns). */
export const ORG_S3_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.S3_BROWSE,
  ORG_WORKSPACE_PERMISSIONS.S3_ADD,
  ORG_WORKSPACE_PERMISSIONS.S3_EDIT,
];

/** Keys under Management → Advanced in the permissions matrix. */
export const ORG_MANAGEMENT_ADVANCED_PERMISSION_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW,
  ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG,
  ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS,
  ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS,
  ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS,
];

const TABLE_COLUMN_EXCLUDED_ADVANCED_KEYS = new Set<OrgWorkspacePermissionKey>([
  ...ORG_PROJECTS_ADVANCED_PERMISSION_KEYS,
  ...ORG_REMOTE_SERVER_ADVANCED_PERMISSION_KEYS,
  ...ORG_DOMAINS_ADVANCED_PERMISSION_KEYS,
  ...ORG_WEBHOOKS_ADVANCED_PERMISSION_KEYS,
  ...ORG_CRON_JOBS_ADVANCED_PERMISSION_KEYS,
  ...ORG_NOTIFICATIONS_ADVANCED_PERMISSION_KEYS,
  ...ORG_S3_ADVANCED_PERMISSION_KEYS,
  ...ORG_MANAGEMENT_ADVANCED_PERMISSION_KEYS,
]);

/** Short labels for settings matrix (English UI). */
export const ORG_WORKSPACE_PERMISSION_LABELS: Record<OrgWorkspacePermissionKey, string> = {
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS]: "Projects",
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS_VIEW]: "Projects · View",
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS_ADD]: "Projects · Add",
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS_DELETE]: "Projects · Delete",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]: "Servers",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL]: "Remote · Terminal",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER]: "Remote · Docker Manager",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TEST]: "Remote · Test",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_ADD]: "Remote · Add",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_EDIT]: "Remote · Edit",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DELETE]: "Remote · Delete",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_INSTALL_MAINTENANCE]: "Remote · Install & maintenance",
  [ORG_WORKSPACE_PERMISSIONS.DOMAINS]: "Domains",
  [ORG_WORKSPACE_PERMISSIONS.DOMAINS_CERTIFICATE_EMAIL]: "Domains · Certificate email",
  [ORG_WORKSPACE_PERMISSIONS.DOMAINS_ADD]: "Domains · Add sites",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS]: "Webhooks",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_ADD]: "Webhooks · Add",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_EDIT]: "Webhooks · Edit",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_LOGS]: "Webhooks · Logs",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_RUN]: "Webhooks · Run",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_DELETE]: "Webhooks · Delete",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS]: "Cron jobs",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_ADD]: "Cron jobs · Add",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_EDIT]: "Cron jobs · Edit",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_LOGS]: "Cron jobs · Logs",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_RUN]: "Cron jobs · Run",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_DELETE]: "Cron jobs · Delete",
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS]: "Notifications",
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_ADD]: "Notifications · Add",
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT]: "Notifications · Edit",
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_TEST]: "Notifications · Test",
  [ORG_WORKSPACE_PERMISSIONS.S3]: "S3 destinations",
  [ORG_WORKSPACE_PERMISSIONS.S3_BROWSE]: "S3 · Browse",
  [ORG_WORKSPACE_PERMISSIONS.S3_ADD]: "S3 · Add",
  [ORG_WORKSPACE_PERMISSIONS.S3_EDIT]: "S3 · Edit",
  [ORG_WORKSPACE_PERMISSIONS.REGISTRY]: "Registry",
  [ORG_WORKSPACE_PERMISSIONS.GIT]: "Git",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]: "Management",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW]: "Management · Overview",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG]: "Management · Audit log",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS]: "Management · Members",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS]: "Management · Permissions",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS]: "Management · Settings",
};

export type OrganizationWorkspacePermissions = Record<OrgWorkspacePermissionKey, boolean>;

export function defaultWorkspacePermissions(): OrganizationWorkspacePermissions {
  const o = {} as OrganizationWorkspacePermissions;
  for (const k of ALL_ORG_WORKSPACE_PERMISSION_KEYS) {
    o[k] = true;
  }
  return o;
}

export function parseWorkspacePermissions(raw: unknown): OrganizationWorkspacePermissions {
  const base = defaultWorkspacePermissions();
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    for (const k of ALL_ORG_WORKSPACE_PERMISSION_KEYS) {
      if (k in rec && typeof rec[k] === "boolean") {
        base[k] = rec[k];
      }
    }
  }
  return base;
}

/** Effective SSH terminal; false when `remote_server` is off or sub-capability denied. */
export function orgMemberAllowsRemoteServerTerminal(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL];
}

/** Effective Docker Manager + Docker builds; false when `remote_server` is off or sub-capability denied. */
export function orgMemberAllowsRemoteServerDockerManager(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER];
}

export function orgMemberAllowsRemoteServerTest(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TEST];
}

export function orgMemberAllowsRemoteServerAdd(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_ADD];
}

export function orgMemberAllowsRemoteServerEdit(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_EDIT];
}

export function orgMemberAllowsRemoteServerDelete(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DELETE];
}

export function orgMemberAllowsRemoteServerInstallMaintenance(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_INSTALL_MAINTENANCE];
}

export function orgMemberAllowsProjectView(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.PROJECTS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.PROJECTS_VIEW];
}

export function orgMemberAllowsProjectAdd(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.PROJECTS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.PROJECTS_ADD];
}

export function orgMemberAllowsProjectDelete(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.PROJECTS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.PROJECTS_DELETE];
}

export function orgMemberAllowsDomainsCertificateEmail(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.DOMAINS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.DOMAINS_CERTIFICATE_EMAIL];
}

export function orgMemberAllowsDomainsAddSites(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.DOMAINS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.DOMAINS_ADD];
}

export function orgMemberAllowsWebhooksAdd(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_ADD];
}

export function orgMemberAllowsWebhooksEdit(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_EDIT];
}

export function orgMemberAllowsWebhooksLogs(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_LOGS];
}

export function orgMemberAllowsWebhooksRun(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_RUN];
}

export function orgMemberAllowsWebhooksDelete(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_DELETE];
}

export function orgMemberAllowsCronJobsAdd(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_ADD];
}

export function orgMemberAllowsCronJobsEdit(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_EDIT];
}

export function orgMemberAllowsCronJobsLogs(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_LOGS];
}

export function orgMemberAllowsCronJobsRun(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_RUN];
}

export function orgMemberAllowsCronJobsDelete(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_DELETE];
}

export function orgMemberAllowsNotificationsAdd(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_ADD];
}

export function orgMemberAllowsNotificationsEdit(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT];
}

export function orgMemberAllowsNotificationsTest(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_TEST];
}

export function orgMemberAllowsS3Browse(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.S3]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.S3_BROWSE];
}

export function orgMemberAllowsS3Add(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.S3]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.S3_ADD];
}

export function orgMemberAllowsS3Edit(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.S3]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.S3_EDIT];
}

export function orgMemberAllowsOrgManagementOverview(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW];
}

export function orgMemberAllowsOrgManagementAuditLog(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG];
}

export function orgMemberAllowsOrgManagementMembers(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS];
}

export function orgMemberAllowsOrgManagementPermissions(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS];
}

export function orgMemberAllowsOrgManagementSettings(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS];
}

/** True when the member can open at least one Management tab (non-owners). Owners always have full management. */
export function orgMemberHasAnyOrgManagementTab(p: OrganizationWorkspacePermissions): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]) return false;
  return ORG_MANAGEMENT_ADVANCED_PERMISSION_KEYS.some((k) => p[k]);
}

/** First management path segment for sidebar links (`overview`, `audit`, …). */
export function firstOrgManagementPathSegment(
  p: OrganizationWorkspacePermissions,
  isOwner: boolean,
): string {
  if (isOwner) return "overview";
  for (const k of ORG_MANAGEMENT_ADVANCED_PERMISSION_KEYS) {
    if (p[k]) {
      if (k === ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW) return "overview";
      if (k === ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG) return "audit";
      if (k === ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS) return "members";
      if (k === ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS) return "permissions";
      if (k === ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS) return "settings";
    }
  }
  return "overview";
}

export type OrgManagementTabMatch = "overview" | "audit" | "members" | "permissions" | "settings";

export function allowedOrgManagementTabMatches(
  p: OrganizationWorkspacePermissions,
  isOwner: boolean,
): Set<OrgManagementTabMatch> {
  if (isOwner) {
    return new Set<OrgManagementTabMatch>([
      "overview",
      "audit",
      "members",
      "permissions",
      "settings",
    ]);
  }
  const s = new Set<OrgManagementTabMatch>();
  if (p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW]) s.add("overview");
  if (p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG]) s.add("audit");
  if (p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS]) s.add("members");
  if (p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS]) s.add("permissions");
  if (p[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS]) s.add("settings");
  return s;
}

/**
 * Parent columns that show an **Advanced** popover in the org permissions matrix.
 * Others (e.g. Registry, Git) are simple checkboxes and are listed last in the table.
 */
export const ORG_WORKSPACE_PERMISSION_TABLE_ADVANCED_PARENT_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.PROJECTS,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER,
  ORG_WORKSPACE_PERMISSIONS.DOMAINS,
  ORG_WORKSPACE_PERMISSIONS.WEBHOOKS,
  ORG_WORKSPACE_PERMISSIONS.CRON_JOBS,
  ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS,
  ORG_WORKSPACE_PERMISSIONS.S3,
  ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT,
];

/** Table columns: top-level areas only; Advanced parents first, simple toggles last. */
export const ORG_WORKSPACE_PERMISSION_TABLE_PRIMARY_KEYS: OrgWorkspacePermissionKey[] = (() => {
  const primary = ALL_ORG_WORKSPACE_PERMISSION_KEYS.filter(
    (k) => !TABLE_COLUMN_EXCLUDED_ADVANCED_KEYS.has(k),
  );
  const advancedParents = new Set<OrgWorkspacePermissionKey>(
    ORG_WORKSPACE_PERMISSION_TABLE_ADVANCED_PARENT_KEYS,
  );
  const withAdvanced = primary.filter((k) => advancedParents.has(k));
  const withoutAdvanced = primary.filter((k) => !advancedParents.has(k));
  return [...withAdvanced, ...withoutAdvanced];
})();

export const ORG_WORKSPACE_REMOTE_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_REMOTE_SERVER_ADVANCED_PERMISSION_KEYS,
];

/** Short labels for the Remote servers → Advanced subsection in the permissions UI. */
export const ORG_WORKSPACE_REMOTE_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL]: "Terminal",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER]: "Docker Manager",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TEST]: "Test",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_ADD]: "Add",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_EDIT]: "Edit",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DELETE]: "Delete",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_INSTALL_MAINTENANCE]: "Install & maintenance",
} as Record<(typeof ORG_WORKSPACE_REMOTE_ADVANCED_KEYS)[number], string>;

export const ORG_WORKSPACE_PROJECTS_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_PROJECTS_ADVANCED_PERMISSION_KEYS,
];

export const ORG_WORKSPACE_PROJECTS_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS_VIEW]: "View",
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS_ADD]: "Add",
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS_DELETE]: "Delete",
} as Record<(typeof ORG_WORKSPACE_PROJECTS_ADVANCED_KEYS)[number], string>;

export const ORG_WORKSPACE_DOMAINS_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_DOMAINS_ADVANCED_PERMISSION_KEYS,
];

export const ORG_WORKSPACE_DOMAINS_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.DOMAINS_CERTIFICATE_EMAIL]: "Certificate email",
  [ORG_WORKSPACE_PERMISSIONS.DOMAINS_ADD]: "Add domain",
} as Record<(typeof ORG_WORKSPACE_DOMAINS_ADVANCED_KEYS)[number], string>;

export const ORG_WORKSPACE_WEBHOOKS_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_WEBHOOKS_ADVANCED_PERMISSION_KEYS,
];

export const ORG_WORKSPACE_WEBHOOKS_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_ADD]: "Add",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_EDIT]: "Edit",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_LOGS]: "Logs",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_RUN]: "Run",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_DELETE]: "Delete",
} as Record<(typeof ORG_WORKSPACE_WEBHOOKS_ADVANCED_KEYS)[number], string>;

export const ORG_WORKSPACE_CRON_JOBS_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_CRON_JOBS_ADVANCED_PERMISSION_KEYS,
];

export const ORG_WORKSPACE_CRON_JOBS_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_ADD]: "Add",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_EDIT]: "Edit",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_LOGS]: "Logs",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_RUN]: "Run",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_DELETE]: "Delete",
} as Record<(typeof ORG_WORKSPACE_CRON_JOBS_ADVANCED_KEYS)[number], string>;

export const ORG_WORKSPACE_NOTIFICATIONS_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_NOTIFICATIONS_ADVANCED_PERMISSION_KEYS,
];

export const ORG_WORKSPACE_NOTIFICATIONS_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_ADD]: "Add",
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT]: "Edit",
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_TEST]: "Test",
} as Record<(typeof ORG_WORKSPACE_NOTIFICATIONS_ADVANCED_KEYS)[number], string>;

export const ORG_WORKSPACE_S3_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_S3_ADVANCED_PERMISSION_KEYS,
];

export const ORG_WORKSPACE_S3_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.S3_BROWSE]: "Browse",
  [ORG_WORKSPACE_PERMISSIONS.S3_ADD]: "Add",
  [ORG_WORKSPACE_PERMISSIONS.S3_EDIT]: "Edit",
} as Record<(typeof ORG_WORKSPACE_S3_ADVANCED_KEYS)[number], string>;

export const ORG_WORKSPACE_MANAGEMENT_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ...ORG_MANAGEMENT_ADVANCED_PERMISSION_KEYS,
];

export const ORG_WORKSPACE_MANAGEMENT_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW]: "Overview",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG]: "Audit log",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS]: "Members",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS]: "Permissions",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS]: "Settings",
} as Record<(typeof ORG_WORKSPACE_MANAGEMENT_ADVANCED_KEYS)[number], string>;
