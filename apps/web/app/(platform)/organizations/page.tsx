import Link from "next/link";
import { Building2, ChevronRight, Clock, Plus } from "lucide-react";
import { fetchOrganizationsListSSR } from "@/lib/server-fetch";

export const dynamic = "force-dynamic";

function formatDateUTC(dateInput: string): string {
  const date = new Date(dateInput);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function OrganizationsPage() {
  const orgs = await fetchOrganizationsListSSR();

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Organizations</h1>
          <p className="text-muted-foreground">
            Shared workspaces you’re part of—open one to work on team projects, servers, and settings in one place.
          </p>
        </div>
        <Link href="/organizations/create" className="btn-primary flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" />
          New organization
        </Link>
      </div>

      {orgs.length === 0 ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-6">
            <Building2 className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No organizations yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            Create one to share servers and projects with your team later.
          </p>
          <Link href="/organizations/create" className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" />
            New organization
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {orgs.map((org) => (
            <div
              key={org.publicId}
              className="relative glass-panel backdrop-blur-none rounded-2xl p-5 flex flex-col gap-3 group interactive-card border border-slate-200 hover:border-primary/35 transition-colors dark:border-white/10 min-h-[140px]"
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="p-2 rounded-lg flex-shrink-0 border bg-primary/10 text-primary border-primary/20">
                    <Building2 className="w-5 h-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <h3 className="font-semibold text-lg leading-tight truncate" title={org.name}>
                        {org.name}
                      </h3>
                      {org.isOwner ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium flex-shrink-0 bg-primary/15 text-primary border border-primary/25">
                          Owner
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-200 text-xs text-muted-foreground dark:border-white/5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1 min-w-0" title={`${formatDateUTC(org.createdAt)} (UTC)`}>
                  <Clock className="w-3 h-3 shrink-0" aria-hidden />
                  <span className="truncate">{formatDateUTC(org.createdAt)}</span>
                </div>
                <Link
                  href={`/organizations/${encodeURIComponent(org.publicId)}/projects`}
                  className="shrink-0 text-primary hover:underline font-medium inline-flex items-center gap-1"
                >
                  View
                  <ChevronRight className="w-3 h-3" aria-hidden />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
