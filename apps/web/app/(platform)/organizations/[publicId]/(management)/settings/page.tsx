import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTab } from "@/lib/org-management-page-guard";
import { OrgSettingsClient } from "./org-settings-client";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function OrganizationSettingsPage({ params }: PageProps) {
  const { publicId: raw } = await params;
  await requireOrgManagementTab(
    raw.trim(),
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_SETTINGS,
  );
  return <OrgSettingsClient />;
}
