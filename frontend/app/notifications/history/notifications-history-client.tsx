"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Clock, Loader2, Search, Trash2, XCircle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/auth-context";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { ListPagination } from "@/components/docker/ListPagination";
import {
  bulkDeleteNotificationLogs,
  deleteNotificationLog,
  fetchNotificationLogsPaged,
  type PaginatedNotificationLogsResponse,
} from "@/lib/notifications-api";

export function NotificationsHistoryClient({
  initialData,
  initialError,
  urlPage,
  urlQ,
}: {
  initialData: PaginatedNotificationLogsResponse | null;
  initialError: string | null;
  urlPage: number;
  urlQ: string;
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const confirm = useConfirm();

  const LOGS_PAGE_SIZE = 10;
  const [logsPage, setLogsPage] = useState(urlPage);
  const [logsQ, setLogsQ] = useState(urlQ);
  const [logsLocalQ, setLogsLocalQ] = useState(urlQ);

  useEffect(() => {
    setLogsPage(urlPage);
    setLogsQ(urlQ);
    setLogsLocalQ(urlQ);
  }, [urlPage, urlQ]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = logsLocalQ.trim();
      if (trimmed === logsQ.trim()) return;
      setLogsQ(trimmed);
      setLogsPage(1);
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 400);
    return () => window.clearTimeout(t);
  }, [logsLocalQ, logsQ, pathname, router]);

  const logsPagedQuery = useQuery({
    queryKey: ["notifications", "logs", "paged", logsPage, logsQ],
    queryFn: () => fetchNotificationLogsPaged(accessToken!, logsPage, LOGS_PAGE_SIZE, logsQ),
    enabled: Boolean(accessToken),
    initialData:
      logsPage === urlPage && logsQ.trim() === urlQ.trim()
        ? (initialData ?? undefined)
        : undefined,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const logsPaged = logsPagedQuery.data;
  const logs = logsPaged?.items ?? [];
  const logKeys = useMemo(() => logs.map((l) => l.id), [logs]);
  const logsBulk = useBulkSelection(logKeys);

  const deleteLogMutation = useMutation({
    mutationFn: (id: string) => deleteNotificationLog(accessToken!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "logs", "paged"] });
    },
  });

  const bulkDeleteLogsMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteNotificationLogs(accessToken!, ids),
    onSuccess: () => {
      logsBulk.clear();
      void queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "logs", "paged"] });
    },
  });

  const handleBulkDeleteLogs = async () => {
    const ids = logsBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected history items?",
      description: `Delete ${ids.length} log item(s)?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    bulkDeleteLogsMutation.mutate(ids);
  };

  const setLogsPageUrl = (next: number) => {
    const n = Math.max(1, next);
    setLogsPage(n);
    const params = new URLSearchParams();
    const q = logsQ.trim();
    if (q) params.set("q", q);
    params.set("page", String(n));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const loading = Boolean(accessToken) && logsPagedQuery.isLoading && !logsPaged;
  const queryErrorMessage =
    logsPagedQuery.error instanceof Error
      ? logsPagedQuery.error.message
      : "Could not load notifications.";
  const listError =
    (Boolean(initialError) && !logsPaged) ||
    (Boolean(accessToken) && logsPagedQuery.isError);
  const listErrorMessage = !logsPaged && initialError ? initialError : queryErrorMessage;

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground text-sm mt-1">History of sent notifications.</p>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-card/50 rounded-xl border border-white/5 w-fit mb-6">
        {[
          { href: "/notifications/channels", label: "Channels", count: 0 },
          { href: "/notifications/history", label: "History", count: logs.length },
        ].map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.div
                  layoutId="notif-tab-route"
                  className="absolute inset-0 bg-white/10 rounded-lg border border-white/10"
                  initial={false}
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
              {t.count > 0 && (
                <span className="relative z-10 bg-primary/20 text-primary text-xs rounded-full px-1.5">
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      )}

      {listError && !loading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {listErrorMessage}
          <button
            type="button"
            className="ml-3 underline underline-offset-2 hover:text-destructive/90"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["notifications", "logs", "paged"] })}
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {logsBulk.selectedInFiltered.length > 0 && (
          <button
            type="button"
            onClick={handleBulkDeleteLogs}
            disabled={bulkDeleteLogsMutation.isPending || deleteLogMutation.isPending}
            className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
          >
            {bulkDeleteLogsMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete ({logsBulk.selectedInFiltered.length})
          </button>
        )}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="input-field !pl-10 w-full"
            placeholder="Search history..."
            value={logsLocalQ}
            onChange={(e) => setLogsLocalQ(e.target.value)}
          />
        </div>
      </div>

      {!loading && !listError && logs.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No notifications sent yet</h3>
          <p className="text-muted-foreground text-sm">Your notification history will appear here.</p>
        </div>
      ) : (
        <>
          <div className="glass-panel rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="py-3 px-4 w-12">
                    <DockerBulkCheckbox
                      checked={logsBulk.allSelected ? true : logsBulk.someSelected ? "indeterminate" : false}
                      onCheckedChange={() => logsBulk.toggleAllFiltered()}
                      aria-label="Select all on this page"
                    />
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Channel
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Message
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Sent At
                  </th>
                  <th className="py-3 px-4 w-12" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <motion.tr
                    key={log.id}
                    initial={false}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <DockerBulkCheckbox
                        checked={logsBulk.selected.has(log.id)}
                        onCheckedChange={() => logsBulk.toggle(log.id)}
                        aria-label={`Select log ${log.id}`}
                      />
                    </td>
                    <td className="py-3.5 px-5">
                      {log.status === "sent" ? (
                        <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Sent
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-400 text-xs font-medium">
                          <XCircle className="w-3.5 h-3.5" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-sm text-muted-foreground">{log.channelName}</span>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-sm truncate max-w-xs block">{log.message}</span>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.sentAt), "MMM d, HH:mm:ss")}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Delete log entry?",
                            description: "This will remove the selected history item.",
                            confirmLabel: "Delete",
                            variant: "destructive",
                          });
                          if (!ok) return;
                          deleteLogMutation.mutate(log.id);
                        }}
                        disabled={deleteLogMutation.isPending || bulkDeleteLogsMutation.isPending}
                        className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        title="Delete log"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {logsPaged ? (
            <ListPagination
              page={logsPaged.page}
              totalPages={Math.max(1, Math.ceil(logsPaged.total / logsPaged.pageSize))}
              onPageChange={setLogsPageUrl}
              from={logsPaged.total > 0 ? (logsPaged.page - 1) * logsPaged.pageSize + 1 : 0}
              to={Math.min(logsPaged.page * logsPaged.pageSize, logsPaged.total)}
              total={logsPaged.total}
            />
          ) : null}
        </>
      )}
    </AppLayout>
  );
}
