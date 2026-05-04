import Link from "next/link";
import { ClipboardList, FolderKanban, UserPlus, Users } from "lucide-react";
import {
  fetchOrganizationAuditLogSSR,
  fetchOrganizationMembersSSR,
  fetchOrganizationProjectsSSR,
  fetchOrganizationSSR,
} from "@/lib/server-fetch";
import {
  organizationAuditActionLabel,
  organizationAuditEndpoint,
  organizationAuditHttpStatus,
} from "@/lib/organization-audit-log-labels";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { ORGANIZATION_MANAGEMENT_BASE } from "@/lib/org-nav-utils";

function memberDisplayName(m: { firstName: string; lastName: string; email: string }): string {
  const n = [m.firstName?.trim(), m.lastName?.trim()].filter(Boolean).join(" ").trim();
  return n.length > 0 ? n : m.email;
}

export default async function OrganizationOverviewPage() {
  const publicId = await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_OVERVIEW,
  );
  const base = ORGANIZATION_MANAGEMENT_BASE;
  const [org, projects, members] = await Promise.all([
    fetchOrganizationSSR(publicId),
    fetchOrganizationProjectsSSR(publicId),
    fetchOrganizationMembersSSR(publicId),
  ]);
  const memberCount = org?.memberCount ?? 1;

  const recentMembers = [...members]
    .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
    .slice(0, 3);

  const canViewAudit =
    org != null &&
    (org.isOwner ||
      org.workspacePermissions[ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG] === true);
  const auditPreview = canViewAudit
    ? (await fetchOrganizationAuditLogSSR(publicId)).slice(0, 3)
    : [];

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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="truncate text-sm font-semibold text-foreground">Audit log</h2>
            </div>
            <Link
              href={`${base}/audit`}
              className="shrink-0 text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="flex flex-1 flex-col px-5 py-3">
            {!canViewAudit ? (
              <p className="py-2 text-sm text-muted-foreground">
                You need the Management · Audit log permission (or owner role) to preview events here.
              </p>
            ) : auditPreview.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No events yet. Membership changes, webhooks, cron jobs, remote terminal use, and similar actions will
                appear here.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {auditPreview.map((e) => {
                  const auditEp = organizationAuditEndpoint(e.metadata);
                  const auditHttp = organizationAuditHttpStatus(e.metadata);
                  return (
                    <li
                      key={e.id}
                      className="flex flex-col gap-0.5 py-2.5 text-sm first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{organizationAuditActionLabel(e.action)}</p>
                        <p className="truncate text-xs text-muted-foreground">{e.actorEmail}</p>
                        {auditEp !== "—" ? (
                          <p className="truncate font-mono text-[10px] text-muted-foreground/90">
                            {auditEp}
                            {auditHttp !== "—" ? ` · HTTP ${auditHttp}` : ""}
                          </p>
                        ) : null}
                      </div>
                      <time
                        className="shrink-0 text-xs tabular-nums text-muted-foreground sm:text-right"
                        dateTime={e.createdAt}
                      >
                        {new Date(e.createdAt).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="flex flex-col rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <UserPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="truncate text-sm font-semibold text-foreground">Latest members</h2>
            </div>
            <Link
              href={`${base}/members`}
              className="shrink-0 text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="flex flex-1 flex-col px-5 py-3">
            {recentMembers.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No member roster loaded. Open Members to see who belongs to this organization.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {recentMembers.map((m) => (
                  <li key={m.email} className="flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{memberDisplayName(m)}</p>
                      {memberDisplayName(m) !== m.email ? (
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      ) : null}
                      {m.isOwner ? (
                        <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wide text-primary">Owner</p>
                      ) : null}
                    </div>
                    <time
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      dateTime={m.joinedAt}
                    >
                      {new Date(m.joinedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
