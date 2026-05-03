import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { OrgSettingsClient } from "./org-settings-client";

export default async function OrganizationSettingsPage() {
  await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS,
  );
  return <OrgSettingsClient />;
}
