import Link from "next/link";
import { FolderKanban, Users } from "lucide-react";
import { fetchOrganizationProjectsSSR, fetchOrganizationSSR } from "@/lib/server-fetch";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { ORGANIZATION_MANAGEMENT_BASE } from "@/lib/org-nav-utils";

export default async function OrganizationOverviewPage() {
  const publicId = await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW,
  );
  const base = ORGANIZATION_MANAGEMENT_BASE;
  const [org, projects] = await Promise.all([
    fetchOrganizationSSR(publicId),
    fetchOrganizationProjectsSSR(publicId),
  ]);
  const memberCount = org?.memberCount ?? 1;

  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Manage membership, audit, access roles, and settings from the tabs above. Projects, servers, and integrations
        use the main sidebar and are scoped to this organization.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/projects"
          className="group rounded-2xl border border-border/80 bg-card/30 p-5 transition-colors hover:border-primary/40 hover:bg-card/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <FolderKanban className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Projects</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{projects.length}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Open the org project list and linked deployments.</p>
        </Link>

        <Link
          href={`${base}/members`}
          className="group rounded-2xl border border-border/80 bg-card/30 p-5 transition-colors hover:border-primary/40 hover:bg-card/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Users className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Members</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{memberCount}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Invite people and manage who can access this workspace.</p>
        </Link>
      </div>
    </div>
  );
}
