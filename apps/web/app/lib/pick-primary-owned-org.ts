import type { OrganizationPublic } from "@/lib/organizations-types";

/**
 * Oldest owned organization by `createdAt` — used for the personal-workspace “Management” nav link.
 */
export function pickPrimaryOwnedOrganization(
  orgs: OrganizationPublic[],
): OrganizationPublic | null {
  const owned = orgs.filter((o) => o.isOwner);
  if (owned.length === 0) return null;
  return [...owned].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )[0]!;
}

/**
 * Default workspace org: prefer oldest owned; otherwise oldest membership (any role).
 */
export function pickDefaultWorkspaceOrganization(
  orgs: OrganizationPublic[],
): OrganizationPublic | null {
  const owned = pickPrimaryOwnedOrganization(orgs);
  if (owned) return owned;
  if (orgs.length === 0) return null;
  return [...orgs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )[0]!;
}
