/** Prefix personal app paths for organization workspace URLs. */
export function prefixOrgHref(orgBase: string, href: string): string {
  const b = orgBase.replace(/\/$/, "");
  if (href.startsWith("http")) return href;
  if (href === "/") return `${b}/projects`;
  return `${b}${href}`;
}

/** Organization management tabs: `/organizations/:id/overview|audit|members|permissions|settings`. */
const ORG_MANAGEMENT_SEGMENTS = ["overview", "audit", "members", "permissions", "settings"] as const;

export function isOrgManagementSectionActive(pathname: string, orgBase: string): boolean {
  const b = orgBase.replace(/\/$/, "");
  for (const seg of ORG_MANAGEMENT_SEGMENTS) {
    const prefix = `${b}/${seg}`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/** Mirrors the personal sidebar `isActive` logic for paths under `/organizations/:publicId/...`. */
export function orgPersonalNavIsActive(pathname: string, orgBase: string, personalHref: string): boolean {
  const b = orgBase.replace(/\/$/, "");
  if (personalHref === "/") {
    return pathname === `${b}/projects` || pathname.startsWith(`${b}/projects/`);
  }
  if (personalHref === "/notifications") return pathname.startsWith(`${b}/notifications`);
  if (personalHref === "/registry") {
    return pathname === `${b}/registry` || pathname.startsWith(`${b}/registry/`);
  }
  if (personalHref === "/git") {
    return pathname === `${b}/git` || pathname.startsWith(`${b}/git/`);
  }
  if (personalHref === "/remote-server") {
    return pathname === `${b}/remote-server` || pathname.startsWith(`${b}/remote-server/`);
  }
  if (personalHref === "/organizations") {
    if (pathname === b || pathname.startsWith(`${b}/`)) return false;
    return pathname === "/organizations" || pathname.startsWith("/organizations/");
  }
  const p = `${b}${personalHref}`;
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
