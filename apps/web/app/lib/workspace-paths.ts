/**
 * Builds routes for the org workspace shell vs personal account.
 * @param organizationPublicId — omit or empty for `/…` personal paths.
 */
export function workspaceRoute(
  organizationPublicId: string | null | undefined,
  path: string,
): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const t = organizationPublicId?.trim();
  if (!t) return normalized;
  return `/organizations/${encodeURIComponent(t)}${normalized}`;
}
