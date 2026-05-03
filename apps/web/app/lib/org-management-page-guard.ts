import { notFound } from "next/navigation";
import { fetchOrganizationSSR } from "@/lib/server-fetch";
import {
  ORG_WORKSPACE_PERMISSIONS,
  type OrgWorkspacePermissionKey,
} from "@/lib/org-workspace-permissions";
import { redirectOrgWorkspaceAccessDenied } from "@/lib/org-workspace-access-denied";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

/** Server guard: organization management tab requires parent Management + matching sub-permission (owners bypass). */
export async function requireOrgManagementTab(
  publicId: string,
  subKey: OrgWorkspacePermissionKey,
): Promise<void> {
  const id = publicId.trim();
  if (!id) notFound();
  const org = await fetchOrganizationSSR(id);
  if (!org) notFound();
  if (!org.isOwner) {
    if (!org.workspacePermissions[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]) {
      redirectOrgWorkspaceAccessDenied(
        org.publicId,
        ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT,
      );
    }
    if (!org.workspacePermissions[subKey]) {
      redirectOrgWorkspaceAccessDenied(org.publicId, subKey);
    }
  }
}

/** Resolves active org from cookie / default, then enforces the management sub-tab permission. */
export async function requireOrgManagementTabForActiveOrg(
  subKey: OrgWorkspacePermissionKey,
): Promise<string> {
  const id = await getServerActiveOrganizationPublicId();
  if (!id) notFound();
  await requireOrgManagementTab(id, subKey);
  return id;
}
