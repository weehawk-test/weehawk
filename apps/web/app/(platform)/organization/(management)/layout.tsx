import { notFound, redirect } from "next/navigation";
import { fetchOrganizationSSR } from "@/lib/server-fetch";
import { OrgManagementTabs } from "@/components/org/org-management-tabs";
import {
  ORG_WORKSPACE_PERMISSIONS,
  allowedOrgManagementTabMatches,
  orgMemberHasAnyOrgManagementTab,
} from "@/lib/org-workspace-permissions";
import { ORGANIZATION_MANAGEMENT_BASE } from "@/lib/org-nav-utils";
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

  const allowedTabMatches = allowedOrgManagementTabMatches(org.workspacePermissions, org.isOwner);
  const base = ORGANIZATION_MANAGEMENT_BASE;

  return (
    <div className="space-y-6">
      <div className="border-b border-border/80">
        <div className="pb-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{org.name}</h1>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{org.publicId}</p>
        </div>
        <OrgManagementTabs base={base} memberCount={org.memberCount} allowedTabMatches={allowedTabMatches} />
      </div>
      {children}
    </div>
  );
}
