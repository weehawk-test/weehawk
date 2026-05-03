/**
 * Personal app sidebar (Projects, Servers, …) applies only to the main account shell.
 * Inside `/organizations/:publicId/*` we use the organization workspace header/tabs instead.
 */
export function isOrganizationWorkspacePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const match = /^\/organizations\/([^/]+)/u.exec(pathname);
  if (!match) return false;
  const first = match[1];
  return first !== "create" && first !== "new";
}
