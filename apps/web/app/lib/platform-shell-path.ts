/**
 * Routes that keep the legacy personal shell (no org sidebar from cookie).
 * All other authenticated platform routes use {@link OrganizationSidebar} + active org cookie.
 */
export function isPlatformPathExemptFromOrgWorkspaceShell(pathname: string): boolean {
  if (!pathname) return true;
  if (pathname.startsWith("/login") || pathname.startsWith("/register")) return true;
  if (pathname.startsWith("/forgot-password") || pathname.startsWith("/reset-password")) return true;
  if (pathname.startsWith("/auth/")) return true;
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return true;
  if (pathname.startsWith("/docker-manager")) return true;
  if (pathname.startsWith("/organizations/create") || pathname.startsWith("/organizations/new")) return true;
  if (pathname.startsWith("/accept-org-invite")) return true;
  if (pathname.startsWith("/resource-not-found")) return true;
  if (pathname.startsWith("/console-not-found")) return true;
  if (pathname.startsWith("/api/")) return true;
  return false;
}

export function usesOrgWorkspaceShell(pathname: string): boolean {
  return !isPlatformPathExemptFromOrgWorkspaceShell(pathname);
}
