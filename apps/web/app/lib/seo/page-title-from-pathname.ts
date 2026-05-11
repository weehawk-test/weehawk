/** Shared with middleware + root metadata — keep in sync with route structure. */
export function pageLabelFromPathname(pathname: string): string {
  const path = pathname.toLowerCase();

  if (path === "/" || path === "/home") return "Home";
  if (path === "/projects") return "Projects";
  if (path.startsWith("/projects/")) return "Services";
  if (path.startsWith("/docker-manager/")) return "Docker Manager";
  if (path === "/remote-server/add-this-machine") return "Add This Server";
  if (path === "/remote-server/add-host") return "Add host";
  if (path.startsWith("/remote-server")) return "Remote Servers";
  if (path.startsWith("/domains")) return "Domains";
  if (path.startsWith("/webhooks")) return "Webhooks";
  if (path.startsWith("/cron-jobs")) return "Cron Jobs";
  if (path.startsWith("/notifications")) return "Notifications";
  if (path.startsWith("/registry")) return "Registry";
  if (path.startsWith("/git")) return "Git";
  if (path.startsWith("/s3")) return "S3 Destinations";
  if (path.startsWith("/news")) return "News";
  if (path.startsWith("/profile")) return "Profile";
  if (path.startsWith("/login")) return "Login";
  if (path.startsWith("/register")) return "Register";
  if (path.startsWith("/forgot-password")) return "Forgot Password";
  if (path.startsWith("/reset-password")) return "Reset Password";
  if (path === "/onboarding/self-hosted-deploy") return "Install — Deploy target";
  if (path === "/onboarding/self-hosted-this-machine") return "Install — This machine";
  if (path.startsWith("/onboarding")) return "Onboarding";
  if (path.startsWith("/docker")) return "Docker";

  return "Weehawk";
}

export function documentTitleFromPathname(pathname: string): string {
  const pageTitle = pageLabelFromPathname(pathname);
  return pageTitle === "Weehawk" ? "Weehawk" : `${pageTitle} | Weehawk`;
}
