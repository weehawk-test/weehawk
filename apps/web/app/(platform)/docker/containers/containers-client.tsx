"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Box, Search, Clock, Activity, RefreshCw, Loader2, AlertCircle, Trash2, ScrollText, OctagonAlert } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { DOCKER_API_HELP, type ContainerStatus } from "@/lib/docker-api";
import {
  deleteRemoteConsoleContainer,
  fetchRemoteConsoleContainerLogs,
  fetchRemoteConsoleContainersPaged,
} from "@/lib/remote-console-api";
import type { DockerConsoleTarget } from "@/lib/console-target";
import { DOCKER_LIST_PAGE_SIZE } from "@/lib/docker-paged-fetch";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { ForceDeleteDialog } from "@/components/confirm/force-delete-dialog";
import { ConfirmDangerDescription } from "@/components/confirm/confirm-danger-description";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<ContainerStatus, string> = {
  running: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  stopped: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  exited: "bg-red-500/10 text-red-400 border-red-500/20",
};

function formatCreated(value: string) {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return format(d, "MMM d");
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

type Props = {
  consoleTarget: DockerConsoleTarget;
  urlPage: number;
  urlQ: string;
};

export function DockerContainersClient({ consoleTarget, urlPage, urlQ }: Props) {
  const { accessToken } = useAuth();
  const { page, q, localQ, setLocalQ, setPage } = useDockerListUrl(urlPage, urlQ);
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

  const listQuery = useQuery({
    queryKey: ["console", "containers", consoleTarget, page, q],
    queryFn: async () => {
      if (!accessToken) throw new Error("Sign in required");
      return fetchRemoteConsoleContainersPaged(
        accessToken,
        consoleTarget,
        page,
        DOCKER_LIST_PAGE_SIZE,
        q,
      );
    },
    enabled: Boolean(accessToken),
  });

  const liveData = listQuery.data ?? null;
  const liveError = listQuery.error
    ? listQuery.error instanceof Error
      ? listQuery.error.message
      : String(listQuery.error)
    : null;

  const loadLogs = useCallback(async () => {
    if (!logTarget) return;
    setLogLoading(true);
    setLogError(null);
    try {
      const t = await fetchRemoteConsoleContainerLogs(
        accessToken ?? "",
        consoleTarget,
        logTarget.id,
        logTail,
      );
      setLogText(t.trim() ? t : "(no log output in this range)");
    } catch (e) {
      setLogText("");
      setLogError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogLoading(false);
    }
  }, [logTarget, logTail, consoleTarget, accessToken]);

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
    const running = targets.filter((c) => c.status === "running").length;
    const confirmed = await confirm({
      title: "Remove selected containers?",
      description: (
        <ConfirmDangerDescription
          lead={
            <p>
              Remove {targets.length} container(s)?
              {running > 0 ? (
                <span className="block mt-1 text-xs">
                  {running} are running and will be force-removed.
                </span>
              ) : null}
            </p>
          }
          emphasis={targets.map((c) => (c.name.trim() ? `${c.name}\n${c.id}` : c.id)).join("\n\n")}
        />
      ),
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBulkPending(true);
    const results = await Promise.allSettled(
      targets.map((c) =>
        deleteRemoteConsoleContainer(accessToken ?? "", consoleTarget, c.id, true),
      ),
    );
    setBulkPending(false);
    const removed = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - removed;
    bulk.clear();
    void listQuery.refetch();
    toast({
      title: "Bulk remove finished",
      description: `${removed} removed${fail ? `, ${fail} failed` : ""}.`,
      variant: fail ? "destructive" : "default",
    });
  };

  const handleDelete = async (id: string, name: string, status: ContainerStatus) => {
    const display = name.trim() ? (name.trim() === id ? name.trim() : `${name.trim()}\n${id}`) : id;
    const ok = await confirm({
      title: status === "running" ? "Force-remove running container?" : "Remove container?",
      description: (
        <ConfirmDangerDescription
          lead={<p>{status === "running" ? "Remove this running container?" : "Remove this container?"}</p>}
          emphasis={display}
          hint={status === "running" ? "Running containers usually require force delete." : undefined}
        />
      ),
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    (async () => {
      try {
        await deleteRemoteConsoleContainer(accessToken ?? "", consoleTarget, id, false);
        toast({ title: "Container removed", description: name });
        void listQuery.refetch();
      } catch (e) {
        toast({
          title: "Failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
    })();
  };

  const runForceDelete = async () => {
    if (!forceDialog) return;
    setForcePending(forceDialog.id);
    try {
      await deleteRemoteConsoleContainer(
        accessToken ?? "",
        consoleTarget,
        forceDialog.id,
        true,
      );
      toast({ title: "Container removed (force)", description: forceDialog.name });
      setForceDialog(null);
      void listQuery.refetch();
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
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Docker Containers</h1>
          <p className="text-muted-foreground text-sm mt-1">Server-paged list from Docker. Use Refresh to update.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {bulk.selectedInFiltered.length > 0 && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkPending || listQuery.isFetching}
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
            <p className="font-medium text-destructive">Could not load containers</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{listError}</p>
            <p className="text-muted-foreground text-xs mt-2">{DOCKER_API_HELP}</p>
          </div>
        </div>
      )}

      {counts && !isError && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {(["running", "stopped", "exited"] as ContainerStatus[]).map((s) => {
            const count =
              s === "running" ? counts.running : s === "stopped" ? counts.stopped : counts.exited;
            return (
              <div key={s} className={`glass-panel rounded-xl p-4 border ${STATUS_STYLE[s].split(" ")[2]}`}>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 capitalize">{s}</p>
                <p className={`text-2xl font-bold ${STATUS_STYLE[s].split(" ")[1]}`}>{count}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 items-stretch mb-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            className="input-field !pl-10 w-full"
            placeholder="Search containers..."
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => void listQuery.refetch()}
          disabled={listQuery.isFetching}
          className="btn-secondary shrink-0 px-3 flex items-center justify-center min-w-[2.75rem]"
          title="Refresh"
          aria-label="Refresh list"
        >
          <RefreshCw className={cn("w-4 h-4", listQuery.isFetching && "animate-spin")} />
        </button>
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
            <Box className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No containers found</h3>
          <p className="text-muted-foreground text-sm">No containers match your search, or the engine returned an empty list.</p>
        </div>
      ) : currentData ? (
        <>
          <div className="space-y-3">
            {items.map((c) => (
              <div
                key={c.id}
                className="glass-panel rounded-xl overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] group"
              >
                <div className="flex items-center justify-between gap-4 p-4 min-w-max">
                  <div className="flex items-center gap-3">
                    <DockerBulkCheckbox
                      checked={bulk.selected.has(c.id)}
                      onCheckedChange={() => bulk.toggle(c.id)}
                      className="flex-shrink-0"
                      aria-label={`Select ${c.name}`}
                    />
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 ${STATUS_STYLE[c.status]}`}>
                      <Box className="w-5 h-5" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-nowrap">
                        <span className="font-semibold text-sm whitespace-nowrap" title={c.name}>
                          {c.name}
                        </span>
                        <span className={`text-[11px] border rounded-full px-2 py-0.5 font-medium capitalize shrink-0 ${STATUS_STYLE[c.status]}`}>
                          {c.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono whitespace-nowrap" title={c.image}>
                        {c.image}
                      </p>
                      <p className="text-xs text-muted-foreground whitespace-nowrap">
                        Ports: {c.ports || "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ps-2">
                  <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatCreated(c.createdAt)}
                  </span>
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
                    title="Force remove container"
                  >
                    {forcePending === c.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <OctagonAlert className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id, c.name, c.status)}
                    disabled={forcePending === c.id}
                    className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove container"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  </div>
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
              Last lines from <code className="text-xs bg-muted px-1 rounded">docker logs</code> on the server host.
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
      <ForceDeleteDialog
        open={!!forceDialog}
        onOpenChange={(open) => !open && setForceDialog(null)}
        title="Force delete container"
        onConfirm={runForceDelete}
        pending={!!forcePending}
      >
        <div className="space-y-3 text-left">
          <p>
            This runs <strong className="text-foreground">docker rm -f</strong> and will stop then remove the container.
          </p>
          <p>
            This can interrupt running workloads immediately. Use it only when normal remove fails or when this is intended.
          </p>
          {forceDialog ? (
            <div>
              <span className="text-xs font-medium text-foreground">Command on the API host:</span>
              <code className="mt-1 block w-full rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 text-[11px] font-mono text-zinc-200 break-all">
                docker rm -f {forceDialog.id}
              </code>
            </div>
          ) : null}
        </div>
      </ForceDeleteDialog>
    </>
  );
}
