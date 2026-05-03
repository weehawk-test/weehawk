/** Prefix for main nav: flat workspace paths (active org comes from cookie). */
export function prefixOrgHref(_orgBaseUnused: string, href: string): string {
  if (href.startsWith("http")) return href;
  if (href === "/") return "/projects";
  return href;
}

/** Organization management: `/organization/overview`, … */
export const ORGANIZATION_MANAGEMENT_BASE = "/organization";

const ORG_MANAGEMENT_SEGMENTS = ["overview", "audit", "members", "permissions", "settings"] as const;

export function isOrgManagementSectionActive(pathname: string, _orgBaseUnused: string): boolean {
  for (const seg of ORG_MANAGEMENT_SEGMENTS) {
    const prefix = `${ORGANIZATION_MANAGEMENT_BASE}/${seg}`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/** Active state for sidebar rows under flat org workspace URLs. */
export function orgPersonalNavIsActive(pathname: string, _orgBaseUnused: string, personalHref: string): boolean {
  if (personalHref === "/") {
    return pathname === "/projects" || pathname.startsWith("/projects/");
  }
  if (personalHref === "/notifications") return pathname.startsWith("/notifications");
  if (personalHref === "/registry") {
    return pathname === "/registry" || pathname.startsWith("/registry/");
  }
  if (personalHref === "/git") {
    return pathname === "/git" || pathname.startsWith("/git/");
  }
  if (personalHref === "/remote-server") {
    return pathname === "/remote-server" || pathname.startsWith("/remote-server/");
  }
  if (personalHref === "/organization") {
    return isOrgManagementSectionActive(pathname, "");
  }
  const p = personalHref.startsWith("/") ? personalHref : `/${personalHref}`;
  if (personalHref.includes("/secrets")) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true;
    return false;
  }
  return pathname === p || pathname.startsWith(`${p}/`);
}

export function orgFullHrefIsActive(pathname: string, href: string): boolean {
  if (href.includes("/secrets")) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return true;
    return false;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
