/** Cookie storing the active organization for flat URLs (`/projects`, …). */
export const WEHAWK_ACTIVE_ORG_COOKIE = "weehawk_active_org_public_id";

export const ACTIVE_ORG_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;

/** Client: set when switching workspace (non-httpOnly so navigation stays synchronous). */
export function setActiveOrganizationPublicBrowserCookie(publicId: string): void {
  if (typeof document === "undefined") return;
  const v = encodeURIComponent(publicId.trim());
  document.cookie = `${WEHAWK_ACTIVE_ORG_COOKIE}=${v}; Path=/; Max-Age=${ACTIVE_ORG_COOKIE_MAX_AGE_SEC}; SameSite=Lax`;
}
