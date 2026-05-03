import { redirect } from "next/navigation";
import type { OrgWorkspacePermissionKey } from "@/lib/org-workspace-permissions";

/** Query flags for `/resource-not-found` when org workspace permissions block the route. */
export const ORG_WORKSPACE_ACCESS_DENIED_REASON = "org-workspace";

export function redirectOrgWorkspaceAccessDenied(
  organizationPublicId: string,
  deniedPermission?: OrgWorkspacePermissionKey,
): never {
  const id = organizationPublicId.trim();
  const q = new URLSearchParams({
    reason: ORG_WORKSPACE_ACCESS_DENIED_REASON,
    org: id,
  });
  if (deniedPermission) {
    q.set("denied", deniedPermission);
  }
  redirect(`/resource-not-found?${q.toString()}`);
}
