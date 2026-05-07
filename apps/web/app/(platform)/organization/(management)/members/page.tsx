import { fetchOrganizationMembersSSR } from "@/lib/server-fetch";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { OrgMembersClient } from "./org-members-client";

export default async function OrganizationMembersPage() {
  const publicId = await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_MEMBERS,
  );
  const members = await fetchOrganizationMembersSSR(publicId);

  return (
    <OrgMembersClient
      activeOrgPublicId={publicId}
      initialMembers={members}
      intro={
        <p className="text-sm text-muted-foreground md:max-w-2xl">
          Members listed here have accepted access to this organization. Invitations are sent by email; the recipient must
          already have a Weehawk account and accept the link while signed in with that email.
        </p>
      }
    />
  );
}
