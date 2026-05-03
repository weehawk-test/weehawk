const ORG_MANAGEMENT_FIRST_SEGMENTS = new Set([
  "overview",
  "audit",
  "members",
  "permissions",
  "settings",
]);

export type LegacyOrgPathParts = { orgPublicId: string; restPath: string };

/** Match `/organizations/:publicId` or `/organizations/:publicId/...` (excludes create/new). */
export function tryParseLegacyOrganizationsPath(pathname: string): LegacyOrgPathParts | null {
  const m = /^\/organizations\/([^/]+)(\/.*)?$/u.exec(pathname);
  if (!m) return null;
  const rawId = decodeURIComponent(m[1]);
  if (rawId === "create" || rawId === "new") return null;
  const restPath = m[2] ?? "";
  return { orgPublicId: rawId, restPath };
}

/** Map legacy org-prefixed path to flat app URL (management → `/organization/...`). */
export function flatUrlPathFromLegacyOrgPath(restPath: string): string {
  let tail = restPath || "/";
  if (tail === "/" || tail === "") tail = "/projects";
  const first = tail.split("/").filter(Boolean)[0] ?? "";
  if (ORG_MANAGEMENT_FIRST_SEGMENTS.has(first)) {
    return `/organization${tail}`;
  }
  return tail.startsWith("/") ? tail : `/${tail}`;
}
