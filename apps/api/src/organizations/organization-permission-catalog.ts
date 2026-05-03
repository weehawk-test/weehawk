import {
  ALL_ORGANIZATION_WORKSPACE_PERMISSIONS,
  isOrganizationWorkspacePermission,
  ORGANIZATION_WORKSPACE_PERMISSIONS,
  type OrganizationWorkspacePermission,
} from './organization-workspace-permissions';

/**
 * Finer-grained flags under a top-level workspace area. Stored in `organization_memberships.permissions`
 * with dotted paths; `false` denies that path and (for parents) the whole subtree.
 *
 * Add new constants here as you gate more routes/UI, then enforce with
 * `OrganizationsService.assertMemberPermissionPath` (or `membershipAllowsPermissionPath`).
 */
export const ORGANIZATION_FINE_PERMISSIONS = {
  /**
   * Remote API “run SSH command” (`POST .../remote-servers/:id/terminal`) and similar exec paths.
   * Does not remove list/edit server row if only this is false — only blocks terminal/exec.
   */
  REMOTE_SERVER_TERMINAL: 'remote_server.terminal',
} as const;

export type OrganizationFinePermission =
  (typeof ORGANIZATION_FINE_PERMISSIONS)[keyof typeof ORGANIZATION_FINE_PERMISSIONS];

const TOP_LEVEL = new Set<string>(ALL_ORGANIZATION_WORKSPACE_PERMISSIONS);

/** `segment.segment` … — lowercase, underscores, dots only; must start from a known top-level area. */
const SUB_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/**
 * Top-level workspace keys or dotted sub-keys rooted at a top-level key (e.g. `remote_server.terminal`).
 */
export function isAssignableOrganizationPermissionKey(raw: string): boolean {
  const k = raw.trim();
  if (k.length === 0) return false;
  if (isOrganizationWorkspacePermission(k)) return true;
  if (!SUB_KEY_PATTERN.test(k)) return false;
  const root = k.slice(0, k.indexOf('.')) as OrganizationWorkspacePermission;
  return TOP_LEVEL.has(root);
}

/** Labels for API docs / future admin UI (English). */
export const ORGANIZATION_FINE_PERMISSION_LABELS: Record<string, string> = {
  [ORGANIZATION_FINE_PERMISSIONS.REMOTE_SERVER_TERMINAL]:
    'Remote server — API terminal / SSH command execution',
};

export { ORGANIZATION_WORKSPACE_PERMISSIONS };
