/** Mirrors API `ORGANIZATION_WORKSPACE_PERMISSIONS` for UI and routing. */
export const ORG_WORKSPACE_PERMISSIONS = {
  PROJECTS: "projects",
  REMOTE_SERVER: "remote_server",
  REMOTE_SERVER_TERMINAL: "remote_server_terminal",
  REMOTE_SERVER_DOCKER_MANAGER: "remote_server_docker_manager",
  DOMAINS: "domains",
  WEBHOOKS: "webhooks",
  CRON_JOBS: "cron_jobs",
  NOTIFICATIONS: "notifications",
  S3: "s3",
  REGISTRY: "registry",
  GIT: "git",
  ORGANIZATION_MANAGEMENT: "organization_management",
} as const;

export type OrgWorkspacePermissionKey =
  (typeof ORG_WORKSPACE_PERMISSIONS)[keyof typeof ORG_WORKSPACE_PERMISSIONS];

export const ALL_ORG_WORKSPACE_PERMISSION_KEYS = Object.values(
  ORG_WORKSPACE_PERMISSIONS,
) as OrgWorkspacePermissionKey[];

/** Short labels for settings matrix (English UI). */
export const ORG_WORKSPACE_PERMISSION_LABELS: Record<OrgWorkspacePermissionKey, string> = {
  [ORG_WORKSPACE_PERMISSIONS.PROJECTS]: "Projects",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]: "Servers",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL]: "Remote · Terminal",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER]: "Remote · Docker Manager",
  [ORG_WORKSPACE_PERMISSIONS.DOMAINS]: "Domains",
  [ORG_WORKSPACE_PERMISSIONS.WEBHOOKS]: "Webhooks",
  [ORG_WORKSPACE_PERMISSIONS.CRON_JOBS]: "Cron jobs",
  [ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS]: "Notifications",
  [ORG_WORKSPACE_PERMISSIONS.S3]: "S3 destinations",
  [ORG_WORKSPACE_PERMISSIONS.REGISTRY]: "Registry",
  [ORG_WORKSPACE_PERMISSIONS.GIT]: "Git",
  [ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]: "Management",
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

/** Effective SSH terminal (incl. SSH-only tests); false when `remote_server` is off or sub-capability denied. */
export function orgMemberAllowsRemoteServerTerminal(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL];
}

/** Effective Docker Manager + Docker tests; false when `remote_server` is off or sub-capability denied. */
export function orgMemberAllowsRemoteServerDockerManager(
  p: OrganizationWorkspacePermissions,
): boolean {
  if (!p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]) return false;
  return p[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER];
}

/** Table columns: every key except remote sub-capabilities (shown under Remote servers). */
export const ORG_WORKSPACE_PERMISSION_TABLE_PRIMARY_KEYS = ALL_ORG_WORKSPACE_PERMISSION_KEYS.filter(
  (k) =>
    k !== ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL &&
    k !== ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER,
) as OrgWorkspacePermissionKey[];

export const ORG_WORKSPACE_REMOTE_ADVANCED_KEYS: readonly OrgWorkspacePermissionKey[] = [
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL,
  ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER,
];

/** Short labels for the Remote servers → Advanced subsection in the permissions UI. */
export const ORG_WORKSPACE_REMOTE_ADVANCED_LABELS = {
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_TERMINAL]: "Terminal",
  [ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER]: "Docker Manager",
} as Record<(typeof ORG_WORKSPACE_REMOTE_ADVANCED_KEYS)[number], string>;
