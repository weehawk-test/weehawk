import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";
import { requireOrgManagementTabForActiveOrg } from "@/lib/org-management-page-guard";
import { fetchOrganizationAuditLogSSR } from "@/lib/server-fetch";
import { ORGANIZATION_MANAGEMENT_BASE } from "@/lib/org-nav-utils";
import { OrganizationAuditResizableTable } from "@/components/org/organization-audit-resizable-table";

const PAGE_SIZE = 12;

function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(String(v ?? "1"), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export default async function OrganizationAuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string | string[] }>;
}) {
  const publicId = await requireOrgManagementTabForActiveOrg(
    ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG,
  );
  const sp = (await searchParams) ?? {};
  const requestedPage = parsePage(sp.page);
  const { items: entries, total, page, totalPages } = await fetchOrganizationAuditLogSSR(publicId, {
    page: requestedPage,
    pageSize: PAGE_SIZE,
  });

  const basePath = `${ORGANIZATION_MANAGEMENT_BASE}/audit`;
  const prevHref = page > 1 ? `${basePath}?page=${page - 1}` : null;
  const nextHref = totalPages > 0 && page < totalPages ? `${basePath}?page=${page + 1}` : null;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(page * PAGE_SIZE, total);

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
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <OrganizationAuditResizableTable entries={entries} />
          {totalPages > 1 ? (
            <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground tabular-nums sm:text-sm">
                Showing {rangeStart}–{rangeEnd} of {total} · Page {page} of {totalPages}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {prevHref ? (
                  <Link
                    href={prevHref}
                    scroll={false}
                    className="btn-secondary inline-flex items-center justify-center px-3 py-1.5 text-sm"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-border/80 px-3 py-1.5 text-sm text-muted-foreground opacity-50">
                    Previous
                  </span>
                )}
                {nextHref ? (
                  <Link
                    href={nextHref}
                    scroll={false}
                    className="btn-secondary inline-flex items-center justify-center px-3 py-1.5 text-sm"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-border/80 px-3 py-1.5 text-sm text-muted-foreground opacity-50">
                    Next
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="border-t border-border/60 bg-muted/20 px-4 py-2">
              <p className="text-xs text-muted-foreground tabular-nums sm:text-sm">
                {total} {total === 1 ? "entry" : "entries"}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
