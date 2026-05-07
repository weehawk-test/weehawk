import { fetchOrganizationMembersSSR } from "@/lib/server-fetch";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { OrgPermissionsClient } from "./org-permissions-client";

export default async function OrganizationPermissionPage() {
  const publicId = await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS,
  );
  const members = await fetchOrganizationMembersSSR(publicId);

  return <OrgPermissionsClient activeOrgPublicId={publicId} initialMembers={members} />;
}
