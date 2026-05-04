/**
 * React Query key segment for org-filtered API calls.
 * Use `null` when no active org id is available yet; never a string sentinel like "personal".
 */
export function orgScopedQuerySegment(organizationPublicId: string | null | undefined): string | null {
  const t = organizationPublicId?.trim();
  return t ? t : null;
}
