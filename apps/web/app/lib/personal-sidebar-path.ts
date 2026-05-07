import { usesOrgWorkspaceShell } from "@/lib/platform-shell-path";

/**
 * True when the main chrome is the organization sidebar (flat URLs + active org context).
 */
export function isOrganizationWorkspacePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return usesOrgWorkspaceShell(pathname);
}
