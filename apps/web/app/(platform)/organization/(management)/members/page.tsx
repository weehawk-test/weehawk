import { fetchOrganizationMembersSSR, fetchOrganizationSSR } from "@/lib/server-fetch";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { OrgMembersClient } from "./org-members-client";
import { OrgPermissionsClient } from "@/ee/permissions/org-permissions-client";
import { EnterpriseLicenseUpsell } from "@/ee/enterprise-license-upsell";

export default async function OrganizationMembersPage() {
  const publicId = await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS,
  );
  const [members, org] = await Promise.all([
    fetchOrganizationMembersSSR(publicId),
    fetchOrganizationSSR(publicId),
  ]);

  const showPermissions =
    org != null &&
    (org.isOwner ||
      org.workspacePermissions[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_PERMISSIONS] === true);

  return (
    <div className="space-y-10">
      <OrgMembersClient
        activeOrgPublicId={publicId}
        initialMembers={members}
        intro={
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Members</h1>
            <p className="mt-1 text-muted-foreground">
              Manage organization members, roles, and workspace permissions.
            </p>
          </div>
        }
      />
      {showPermissions ? (
        org.enterpriseLicensed ? (
          <OrgPermissionsClient activeOrgPublicId={publicId} initialMembers={members} />
        ) : (
          <EnterpriseLicenseUpsell
            salesUrl={org.enterpriseSalesUrl}
            title="Permissions is an enterprise feature"
            description="Changing workspace-area permissions for members requires an enterprise license on this server."
          />
        )
      ) : null}
    </div>
  );
}
