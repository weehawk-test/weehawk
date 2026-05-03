/**
 * Workspace URLs are flat (`/projects`, …); active organization is the cookie / SSR context.
 * @param _organizationPublicId — ignored for routing; callers may still pass for API/query use.
 */
export function workspaceRoute(
  _organizationPublicId: string | null | undefined,
  path: string,
): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized;
}
