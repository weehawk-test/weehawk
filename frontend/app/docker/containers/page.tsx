"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { Box, Search, Clock, Activity, RefreshCw, Loader2, AlertCircle, Trash2, ScrollText } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDockerContainers, useDeleteDockerContainer } from "@/hooks/use-docker";
import {
  DOCKER_API_HELP,
  deleteDockerContainer,
  fetchDockerContainerLogs,
  type ContainerStatus,
} from "@/lib/docker-api";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

export default function DockerContainers() {
  const { data: containers = [], isLoading, isError, error, refetch, isFetching } = useDockerContainers();
  const del = useDeleteDockerContainer();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [bulkPending, setBulkPending] = useState(false);

  const [logTarget, setLogTarget] = useState<{ id: string; name: string } | null>(null);
  const [logTail, setLogTail] = useState(500);
  const [logText, setLogText] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    if (!logTarget) return;
    setLogLoading(true);
    setLogError(null);
    try {
      const t = await fetchDockerContainerLogs(logTarget.id, logTail);
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

  const filtered = useMemo(
    () =>
      containers.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.image.toLowerCase().includes(search.toLowerCase()),
      ),
    [containers, search],
  );

  const filteredKeys = useMemo(() => filtered.map((c) => c.id), [filtered]);
  const bulk = useBulkSelection(filteredKeys);

  const handleBulkDelete = async () => {
    const targets = filtered.filter((c) => bulk.selectedInFiltered.includes(c.id));
    if (targets.length === 0) return;
    const running = targets.filter((c) => c.status === "running").length;
    const confirmed = await confirm({
      title: "Remove selected containers?",
      description:
        `Remove ${targets.length} container(s)?` +
        (running > 0 ? ` ${running} are running and will be force-removed.` : ""),
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBulkPending(true);
    const results = await Promise.allSettled(targets.map((c) => deleteDockerContainer(c.id)));
    setBulkPending(false);
    const removed = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - removed;
    bulk.clear();
    await refetch();
    toast({
      title: "Bulk remove finished",
      description: `${removed} removed${fail ? `, ${fail} failed` : ""}.`,
      variant: fail ? "destructive" : "default",
    });
  };

  const handleDelete = async (id: string, name: string, status: ContainerStatus) => {
    const ok = await confirm({
      title: status === "running" ? "Force-remove running container?" : "Remove container?",
      description:
        status === "running"
          ? `Force-remove “${name}”? It will be stopped and deleted.`
          : `Remove “${name}”?`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    del.mutate(id, {
      onSuccess: () => toast({ title: "Container removed", description: name }),
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const running = containers.filter((c) => c.status === "running").length;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Docker Containers</h1>
          <p className="text-muted-foreground text-sm mt-1">Live data from Docker via the API.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {bulk.selectedInFiltered.length > 0 && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkPending || del.isPending}
              className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
            >
              {bulkPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete ({bulk.selectedInFiltered.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary flex items-center gap-2 text-sm"
            title="Refresh from server"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
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
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{error instanceof Error ? error.message : "Unknown error"}</p>
            <p className="text-muted-foreground text-xs mt-2">{DOCKER_API_HELP}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        {(["running", "stopped", "exited"] as ContainerStatus[]).map((s) => {
          const count = containers.filter((c) => c.status === s).length;
          return (
            <div key={s} className={`glass-panel rounded-xl p-4 border ${STATUS_STYLE[s].split(" ")[2]}`}>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 capitalize">{s}</p>
              <p className={`text-2xl font-bold ${STATUS_STYLE[s].split(" ")[1]}`}>{count}</p>
            </div>
          );
        })}
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="input-field !pl-10 w-full"
          placeholder="Search containers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center gap-3 mb-6 text-sm">
          <label className="flex items-center gap-2.5 cursor-pointer text-muted-foreground hover:text-foreground select-none">
            <DockerBulkCheckbox
              checked={bulk.allSelected ? true : bulk.someSelected ? "indeterminate" : false}
              onCheckedChange={() => bulk.toggleAllFiltered()}
              aria-label="Select all in list"
            />
            <span>Select all in list ({filtered.length})</span>
          </label>
          {bulk.selectedInFiltered.length > 0 && (
            <span className="text-xs text-muted-foreground">{bulk.selectedInFiltered.length} selected</span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="glass-panel rounded-2xl p-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Loading containers…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <Box className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No containers found</h3>
          <p className="text-muted-foreground text-sm">No containers match your search, or the engine returned an empty list.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
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
                  <p className="text-xs text-muted-foreground mt-0.5">Ports: {c.ports || "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
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
                  onClick={() => handleDelete(c.id, c.name, c.status)}
                  disabled={del.isPending}
                  className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove container"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

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
    </AppLayout>
  );
}
