/**
 * Workspace URLs are flat (`/projects`, …); active organization is server-side context.
 * @param _activeOrgPublicId — ignored for routing; callers may still pass for API/query use.
 */
export function workspaceRoute(
  _activeOrgPublicId: string | null | undefined,
  path: string,
): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized;
}
