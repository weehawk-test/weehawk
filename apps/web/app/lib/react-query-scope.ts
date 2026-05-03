/**
 * React Query key segment for org-filtered API calls.
 * Use `null` when no active org id is available yet; never a string sentinel like "personal".
 */
export function orgScopedQuerySegment(organizationPublicId: string | null | undefined): string | null {
  const t = organizationPublicId?.trim();
  return t ? t : null;
}

/** Git settings API is per-user; second key part stays null until the backend is org-scoped. */
export const GIT_SETTINGS_QUERY_SCOPE = null;

/** Registry accounts API is per-user; second key part stays null until the backend is org-scoped. */
export const REGISTRY_ACCOUNTS_QUERY_SCOPE = null;
