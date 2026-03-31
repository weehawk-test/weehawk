"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Search,
  Activity,
  RefreshCw,
  Loader2,
  AlertCircle,
  Trash2,
  ScrollText,
  OctagonAlert,
  Network,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDeleteDockerService } from "@/hooks/use-docker";
import {
  DOCKER_API_HELP,
  deleteDockerService,
  dockerPagedWsUrl,
  fetchDockerServiceLogs,
  type ServiceStatus,
} from "@/lib/docker-api";
import { DOCKER_LIST_PAGE_SIZE, type PaginatedServicesResponse } from "@/lib/docker-paged-fetch";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { ListPagination } from "@/components/docker/ListPagination";
import { useDockerListUrl } from "@/hooks/use-docker-list-url";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<ServiceStatus, string> = {
  running: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  stopped: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  degraded: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

type Props = {
  data: PaginatedServicesResponse | null;
  error: string | null;
  urlPage: number;
  urlQ: string;
};

export function DockerServicesClient({ data, error, urlPage, urlQ }: Props) {
  const router = useRouter();
  const { page, q, localQ, setLocalQ, setPage } = useDockerListUrl(urlPage, urlQ);
  const del = useDeleteDockerService();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [bulkPending, setBulkPending] = useState(false);
  const [forcePending, setForcePending] = useState<string | null>(null);
  const [forceDialog, setForceDialog] = useState<{ id: string; name: string } | null>(null);

  const [logTarget, setLogTarget] = useState<{ id: string; name: string } | null>(null);
  const [logTail, setLogTail] = useState(500);
  const [logText, setLogText] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<PaginatedServicesResponse | null>(data);
  const [liveError, setLiveError] = useState<string | null>(error);

  useEffect(() => {
    setLiveData(data);
    setLiveError(error);
  }, [data, error, urlPage, urlQ]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    const connect = () => {
      ws = new WebSocket(
        dockerPagedWsUrl({
          topic: "services.paged",
          page,
          pageSize: DOCKER_LIST_PAGE_SIZE,
          q,
          intervalMs: 2000,
        }),
      );
      ws.onmessage = (ev) => {
        if (disposed || typeof ev.data !== "string") return;
        try {
          const msg = JSON.parse(ev.data) as { type?: string; data?: unknown; message?: string };
          if (msg.type === "services.paged" && msg.data) {
            setLiveData(msg.data as PaginatedServicesResponse);
            setLiveError(null);
          } else if (msg.type === "error") {
            setLiveError(msg.message ?? "WebSocket error");
          }
        } catch {
          /* ignore malformed message */
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setTimeout(() => {
          if (!disposed) connect();
        }, 1500);
      };
    };
    connect();
    return () => {
      disposed = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [page, q]);

  const loadLogs = useCallback(async () => {
    if (!logTarget) return;
    setLogLoading(true);
    setLogError(null);
    try {
      const t = await fetchDockerServiceLogs(logTarget.id, logTail);
      setLogText(t.trim() ? t : "(no log output in this range)");
    } catch (e) {
      setLogText("");
      setLogError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogLoading(false);
    }
  }, [logTarget, logTail]);

  useEffect(() => {
    if (logTarget) void loadLogs();
  }, [logTarget, logTail, loadLogs]);

  const currentData = liveData;
  const items = currentData?.items ?? [];
  const filteredKeys = useMemo(() => items.map((c) => c.id), [items]);
  const bulk = useBulkSelection(filteredKeys);

  const handleBulkDelete = async () => {
    const targets = items.filter((c) => bulk.selectedInFiltered.includes(c.id));
    if (targets.length === 0) return;
    const confirmed = await confirm({
      title: "Remove selected services?",
      description: `Remove ${targets.length} service(s)? This will stop scheduling tasks for them.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBulkPending(true);
    const results = await Promise.allSettled(targets.map((c) => deleteDockerService(c.id, true)));
    setBulkPending(false);
    const removed = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - removed;
    bulk.clear();
    router.refresh();
    toast({
      title: "Bulk remove finished",
      description: `${removed} removed${fail ? `, ${fail} failed` : ""}.`,
      variant: fail ? "destructive" : "default",
    });
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Remove service?",
      description: `Remove “${name}”?`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    del.mutate(
      { idOrName: id, force: false },
      {
        onSuccess: () => {
          toast({ title: "Service removed", description: name });
          router.refresh();
        },
        onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
      },
    );
  };

  const runForceDelete = async () => {
    if (!forceDialog) return;
    setForcePending(forceDialog.id);
    try {
      await deleteDockerService(forceDialog.id, true);
      toast({ title: "Service removed (force)", description: forceDialog.name });
      setForceDialog(null);
      router.refresh();
    } catch (e) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setForceDialog(null);
    } finally {
      setForcePending(null);
    }
  };

  const counts = currentData?.counts;
  const running = counts?.running ?? 0;
  const totalPages = currentData ? Math.max(1, Math.ceil(currentData.total / currentData.pageSize)) : 1;
  const from =
    currentData && currentData.total > 0 ? (currentData.page - 1) * currentData.pageSize + 1 : 0;
  const to = currentData ? Math.min(currentData.page * currentData.pageSize, currentData.total) : 0;

  const listError = liveError;
  const isError = !!listError;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Docker Services</h1>
          <p className="text-muted-foreground text-sm mt-1">Live data from Docker Swarm services (server-paged).</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {bulk.selectedInFiltered.length > 0 && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkPending}
              className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
            >
              {bulkPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete ({bulk.selectedInFiltered.length})
            </button>
          )}
          <div className="glass-panel rounded-xl px-4 py-2 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium">{running} running</span>
          </div>
        </div>
      </div>

      {isError && (
        <div className="glass-panel rounded-xl p-4 mb-6 border border-destructive/30 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Could not load services</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{listError}</p>
            <p className="text-muted-foreground text-xs mt-2">{DOCKER_API_HELP}</p>
          </div>
        </div>
      )}

      {counts && !isError && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {(["running", "stopped", "degraded"] as ServiceStatus[]).map((s) => {
            const count =
              s === "running" ? counts.running : s === "stopped" ? counts.stopped : counts.degraded;
            return (
              <div key={s} className={`glass-panel rounded-xl p-4 border ${STATUS_STYLE[s].split(" ")[2]}`}>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 capitalize">{s}</p>
                <p className={`text-2xl font-bold ${STATUS_STYLE[s].split(" ")[1]}`}>{count}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="input-field !pl-10 w-full"
          placeholder="Search services..."
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
        />
      </div>

      {currentData && currentData.total > 0 && !isError && (
        <div className="flex items-center gap-3 mb-6 text-sm">
          <label className="flex items-center gap-2.5 cursor-pointer text-muted-foreground hover:text-foreground select-none">
            <DockerBulkCheckbox
              checked={bulk.allSelected ? true : bulk.someSelected ? "indeterminate" : false}
              onCheckedChange={() => bulk.toggleAllFiltered()}
              aria-label="Select all on this page"
            />
            <span>Select all on this page ({items.length})</span>
          </label>
          {bulk.selectedInFiltered.length > 0 && (
            <span className="text-xs text-muted-foreground">{bulk.selectedInFiltered.length} selected</span>
          )}
        </div>
      )}

      {isError ? null : currentData && currentData.total === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <Network className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No services found</h3>
          <p className="text-muted-foreground text-sm">No services match your search, or Swarm returned an empty list.</p>
        </div>
      ) : currentData ? (
        <>
          <div className="space-y-3">
            {items.map((c) => (
              <div
                key={c.id}
                className="glass-panel rounded-xl p-4 flex items-center justify-between gap-4 group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <DockerBulkCheckbox
                    checked={bulk.selected.has(c.id)}
                    onCheckedChange={() => bulk.toggle(c.id)}
                    className="flex-shrink-0"
                    aria-label={`Select ${c.name}`}
                  />
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 ${STATUS_STYLE[c.status]}`}>
                    <Box className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{c.name}</span>
                      <span className={`text-[11px] border rounded-full px-2 py-0.5 font-medium capitalize ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">{c.image}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Replicas: {c.replicas} • Mode: {c.mode}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setLogTail(500);
                      setLogText("");
                      setLogError(null);
                      setLogTarget({ id: c.id, name: c.name });
                    }}
                    className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                    title="View logs"
                  >
                    <ScrollText className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setForceDialog({ id: c.id, name: c.name })}
                    disabled={forcePending === c.id}
                    className="p-2 rounded-lg hover:bg-amber-500/10 text-muted-foreground hover:text-amber-500 transition-colors"
                    title="Force remove service"
                  >
                    {forcePending === c.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <OctagonAlert className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id, c.name)}
                    disabled={forcePending === c.id}
                    className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove service"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <ListPagination
            page={currentData.page}
            totalPages={totalPages}
            onPageChange={setPage}
            from={from}
            to={to}
            total={currentData.total}
          />
        </>
      ) : null}

      <Dialog
        open={!!logTarget}
        onOpenChange={(open) => {
          if (!open) {
            setLogTarget(null);
            setLogError(null);
          }
        }}
      >
        <DialogContent className="max-w-[min(96vw,56rem)] w-full max-h-[min(85vh,720px)] flex flex-col gap-0 p-0 overflow-hidden sm:max-w-[min(96vw,56rem)]">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border/60 shrink-0">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <ScrollText className="w-5 h-5 text-primary shrink-0" />
              Logs
              {logTarget && (
                <span className="font-mono text-base font-normal text-muted-foreground truncate">
                  {logTarget.name}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Last lines from <code className="text-xs bg-muted px-1 rounded">docker service logs</code> on the server host.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 px-6 py-2 border-b border-border/40 bg-muted/20 shrink-0 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Lines
              <select
                className="input-field !py-1.5 text-xs h-8 min-w-[5rem]"
                value={logTail}
                onChange={(e) => setLogTail(Number(e.target.value))}
              >
                {[200, 500, 1000, 2000, 5000].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadLogs()}
              disabled={logLoading || !logTarget}
              className="btn-secondary text-xs py-1.5 h-8 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${logLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="flex-1 min-h-[200px] overflow-auto px-6 py-4 bg-zinc-950/80">
            {logLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-sm">Loading logs…</p>
              </div>
            ) : logError ? (
              <div className="text-sm text-destructive whitespace-pre-wrap">{logError}</div>
            ) : (
              <pre className="text-xs font-mono text-zinc-200 whitespace-pre-wrap break-all leading-relaxed">
                {logText}
              </pre>
            )}
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border/60 shrink-0 sm:justify-between">
            <p className="text-[11px] text-muted-foreground text-left w-full sm:w-auto">
              Timestamps come from Docker when available.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!forceDialog} onOpenChange={(open) => !open && setForceDialog(null)}>
        <AlertDialogContent className="max-w-lg border-amber-500/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-500">
              <OctagonAlert className="w-5 h-5 shrink-0" />
              Force delete service
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-muted-foreground">
                <p>
                  This tries to scale the service to zero replicas, then runs{" "}
                  <strong className="text-foreground">docker service rm</strong>.
                </p>
                <p>
                  Running tasks may be interrupted. Use this when normal removal fails.
                </p>
                {forceDialog && (
                  <div>
                    <span className="text-xs font-medium text-foreground">Command on the API host:</span>
                    <code className="mt-1 block w-full rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 text-[11px] font-mono text-zinc-200 break-all">
                      docker service rm {forceDialog.id}
                    </code>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!forcePending}>Cancel</AlertDialogCancel>
            <button
              type="button"
              disabled={!!forcePending}
              className={cn(buttonVariants({ variant: "destructive" }), "gap-2")}
              onClick={runForceDelete}
            >
              {forcePending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirm force delete
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
