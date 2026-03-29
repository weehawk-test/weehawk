"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { KeyRound, Search, Shield, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useDockerSecretsPaged } from "@/hooks/use-docker-secrets";
import { useDockerListUrl } from "@/hooks/use-docker-list-url";
import { ListPagination } from "@/components/docker/ListPagination";
import { formatSecretDate } from "@/lib/format-secret-date";

function ServiceSecretsTabInner() {
  const searchParams = useSearchParams();
  const urlPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const urlQ = searchParams.get("q") ?? "";
  const { localQ, setLocalQ, setPage, refresh, q } = useDockerListUrl(urlPage, urlQ);
  const { data, isLoading, isError, error, refetch } = useDockerSecretsPaged(urlPage, q);

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const listError = isError ? (error instanceof Error ? error.message : String(error)) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name…"
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            className="input-field !pl-12 w-full bg-card/50"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void refetch();
              refresh();
            }}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <Link href="/secrets">
            <button type="button" className="btn-primary flex items-center gap-2 text-sm">
              <KeyRound className="w-4 h-4" />
              Manage Secrets
            </button>
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Docker Swarm secrets on the host (same list as the <span className="text-foreground font-medium">Secrets</span> page).
        Values are never shown here.
      </p>

      {listError && (
        <div className="glass-panel rounded-xl p-4 border border-destructive/30 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Could not load secrets</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{listError}</p>
          </div>
        </div>
      )}

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Loading secrets…</span>
        </div>
      ) : !listError && data && data.total === 0 ? (
        <div className="glass-panel rounded-2xl p-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No Docker secrets</h3>
          <p className="text-muted-foreground text-sm mb-5 max-w-sm">
            {q.trim()
              ? "No secrets match your search."
              : "Create secrets on the Secrets page (requires Swarm). Values are never shown here."}
          </p>
          {!q.trim() && (
            <Link href="/secrets">
              <button type="button" className="btn-primary text-sm flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                Go to Docker Secrets
              </button>
            </Link>
          )}
        </div>
      ) : data && data.total > 0 ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((secret, i) => (
                <motion.tr
                  key={`${secret.id}-${secret.name}`}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3.5 px-5">
                    <span className="font-mono text-sm text-primary font-medium">{secret.name}</span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs text-muted-foreground">{formatSecretDate(secret.createdAt)}</span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <ListPagination
            page={data.page}
            totalPages={totalPages}
            onPageChange={setPage}
            from={from}
            to={to}
            total={data.total}
            className="px-5 pb-4"
          />
        </div>
      ) : null}
    </div>
  );
}

function SecretsTabFallback() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <Loader2 className="w-6 h-6 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

/** Secrets list with URL pagination/search (aligned with `/secrets`). */
export function ServiceSecretsTab() {
  return (
    <Suspense fallback={<SecretsTabFallback />}>
      <ServiceSecretsTabInner />
    </Suspense>
  );
}
