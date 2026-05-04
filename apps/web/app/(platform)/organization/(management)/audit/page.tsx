import { ClipboardList } from "lucide-react";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { fetchOrganizationAuditLogSSR } from "@/lib/server-fetch";
import {
  organizationAuditActionLabel,
  organizationAuditEndpoint,
  organizationAuditHttpStatus,
  organizationAuditTargetSummary,
} from "@/lib/organization-audit-log-labels";

export default async function OrganizationAuditPage() {
  const publicId = await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG,
  );
  const entries = await fetchOrganizationAuditLogSSR(publicId);

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Membership and settings changes, projects, remote servers (including Docker console and install jobs), Domains,
        notifications, S3 workspace actions, webhooks, cron jobs, and remote terminal runs — with API endpoint, HTTP
        status when recorded, and actor.
      </p>

      {entries.length === 0 ? (
        <div className="glass-panel rounded-2xl border border-dashed border-border/80 p-10 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted/50">
            <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
          </div>
          <h2 className="mt-6 text-lg font-semibold text-foreground">No entries yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Events appear after invites, permission changes, project or server CRUD, S3 or notification changes, domain or
            certificate email updates, Traefik settings, webhook or cron job changes, remote Docker or terminal use, and
            similar actions.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-border/60 bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">API</th>
                <th className="whitespace-nowrap px-4 py-3">HTTP</th>
                <th className="px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/20">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                    <time dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-foreground">{e.actorEmail}</td>
                  <td className="px-4 py-3 text-foreground">{organizationAuditActionLabel(e.action)}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 font-mono text-[11px] text-muted-foreground">
                    {organizationAuditEndpoint(e.metadata)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                    {organizationAuditHttpStatus(e.metadata)}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-muted-foreground">
                    {organizationAuditTargetSummary(e.targetEmail, e.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
