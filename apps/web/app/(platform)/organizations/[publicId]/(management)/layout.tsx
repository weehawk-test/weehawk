import { notFound, redirect } from "next/navigation";
import { fetchOrganizationMembersSSR, fetchOrganizationSSR } from "@/lib/server-fetch";
import { OrgManagementTabs } from "@/components/org/org-management-tabs";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";

export default async function OrganizationManagementLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ publicId: string }>;
}) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  const org = await fetchOrganizationSSR(publicId);
  if (!org) notFound();
  if (
    !org.isOwner &&
    !org.workspacePermissions[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT]
  ) {
    redirect(`/organizations/${encodeURIComponent(org.publicId)}/projects`);
  }

  const members = await fetchOrganizationMembersSSR(org.publicId);
  const base = `/organizations/${encodeURIComponent(org.publicId)}`;

  return (
    <div className="space-y-6">
      <div className="border-b border-border/80">
        <div className="pb-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{org.name}</h1>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{org.publicId}</p>
        </div>
        <OrgManagementTabs base={base} memberCount={members.length} />
      </div>
      {children}
    </div>
  );
}
