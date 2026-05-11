import { notFound, redirect } from "next/navigation";
import { fetchOrganizationSSR } from "@/lib/server-fetch";
import {
  ORG_WORKSPACE_PERMISSIONS,
  orgMemberHasAnyOrgManagementTab,
} from "@/lib/org-workspace-permissions";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

export default async function OrganizationManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const publicId = (await getServerActiveOrganizationPublicId()) ?? "";
  if (!publicId) notFound();
  const org = await fetchOrganizationSSR(publicId);
  if (!org) notFound();
  if (
    !org.isOwner &&
    !org.workspacePermissions[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]
  ) {
    redirect("/home");
  }
  if (!org.isOwner && !orgMemberHasAnyOrgManagementTab(org.workspacePermissions)) {
    redirect("/home");
  }

  return <>{children}</>;
}
