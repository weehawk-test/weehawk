import { fetchOrganizationMembersSSR } from "@/lib/server-fetch";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTab } from "@/lib/org-management-page-guard";
import { OrgPermissionsClient } from "./org-permissions-client";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function OrganizationPermissionPage({ params }: PageProps) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  await requireOrgManagementTab(
    publicId,
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS,
  );
  const members = await fetchOrganizationMembersSSR(publicId);

  return (
    <OrgPermissionsClient organizationPublicId={publicId} initialMembers={members} />
  );
}
