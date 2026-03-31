"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Database, Search, HardDrive, Clock, Loader2, AlertCircle, Trash2, OctagonAlert } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDeleteDockerVolume } from "@/hooks/use-docker";
import { DOCKER_API_HELP, deleteDockerVolume, dockerPagedWsUrl } from "@/lib/docker-api";
import { DOCKER_LIST_PAGE_SIZE, type PaginatedVolumesResponse } from "@/lib/docker-paged-fetch";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { ListPagination } from "@/components/docker/ListPagination";
import { useDockerListUrl } from "@/hooks/use-docker-list-url";
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

function formatCreatedAt(value: string) {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return format(d, "MMM d, yyyy HH:mm");
  const t = value.trim();
  return t.length > 22 ? `${t.slice(0, 22)}…` : t || "—";
}

type Props = {
  data: PaginatedVolumesResponse | null;
  error: string | null;
  urlPage: number;
  urlQ: string;
};

export function DockerVolumesClient({ data, error, urlPage, urlQ }: Props) {
  const router = useRouter();
  const { page, q, localQ, setLocalQ, setPage } = useDockerListUrl(urlPage, urlQ);
  const del = useDeleteDockerVolume();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [bulkPending, setBulkPending] = useState(false);
  const [forcePending, setForcePending] = useState<string | null>(null);
  const [forceDialog, setForceDialog] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<PaginatedVolumesResponse | null>(data);
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
          topic: "volumes.paged",
          page,
          pageSize: DOCKER_LIST_PAGE_SIZE,
          q,
          intervalMs: 3000,
          includeSizes: true,
        }),
      );
      ws.onmessage = (ev) => {
        if (disposed || typeof ev.data !== "string") return;
        try {
          const msg = JSON.parse(ev.data) as { type?: string; data?: unknown; message?: string };
          if (msg.type === "volumes.paged" && msg.data) {
            setLiveData(msg.data as PaginatedVolumesResponse);
            setLiveError(null);
          } else if (msg.type === "error") {
            setLiveError(msg.message ?? "WebSocket error");
          }
        } catch {}
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
      } catch {}
    };
  }, [page, q]);

  const currentData = liveData;
  const items = currentData?.items ?? [];
  const filteredKeys = useMemo(() => items.map((v) => v.name), [items]);
  const bulk = useBulkSelection(filteredKeys);

  const totalPages = currentData ? Math.max(1, Math.ceil(currentData.total / currentData.pageSize)) : 1;
  const from = currentData && currentData.total > 0 ? (currentData.page - 1) * currentData.pageSize + 1 : 0;
  const to = currentData ? Math.min(currentData.page * currentData.pageSize, currentData.total) : 0;
  const totalAll = currentData?.totalAll ?? 0;

  const handleBulkDelete = async () => {
    const names = bulk.selectedInFiltered;
    if (names.length === 0) return;
    const confirmed = await confirm({
      title: "Delete selected volumes?",
      description: `Delete ${names.length} volume(s)? This fails if a container still uses a volume.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBulkPending(true);
    const results = await Promise.allSettled(names.map((n) => deleteDockerVolume(n)));
    setBulkPending(false);
    const removed = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - removed;
    bulk.clear();
    router.refresh();
    toast({
      title: "Bulk delete finished",
      description: `${removed} removed${fail ? `, ${fail} failed` : ""}.`,
      variant: fail ? "destructive" : "default",
    });
  };

  const handleDelete = async (name: string) => {
    const ok = await confirm({
      title: "Delete volume?",
      description: `Delete “${name}”? This fails if a container still uses it.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    del.mutate(name, {
      onSuccess: () => {
        toast({ title: "Volume removed", description: name });
        router.refresh();
      },
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const runForceDelete = async () => {
    if (!forceDialog) return;
    setForcePending(forceDialog);
    try {
      await deleteDockerVolume(forceDialog, true);
      toast({ title: "Volume removed (force)", description: forceDialog });
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

  const listError = liveError;
  const isError = !!listError;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Docker Volumes</h1>
          <p className="text-muted-foreground text-sm mt-1">Live data from Docker via the API (server-paged).</p>
        </div>
        <div className="flex items-center gap-2">
          {bulk.selectedInFiltered.length > 0 && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkPending || del.isPending}
              className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2"
            >
              {bulkPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete ({bulk.selectedInFiltered.length})
            </button>
          )}
        </div>
      </div>

      {isError && (
        <div className="glass-panel rounded-xl p-4 mb-6 border border-destructive/30 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Could not load volumes</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{listError}</p>
            <p className="text-muted-foreground text-xs mt-2">{DOCKER_API_HELP}</p>
          </div>
        </div>
      )}

      {!isError && currentData && (
        <div className="glass-panel rounded-xl p-4 mb-6 max-w-md">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total volumes</p>
          <p className="text-2xl font-bold text-primary">{totalAll}</p>
          <p className="text-xs text-muted-foreground mt-2">Size comes from <span className="font-mono">docker system df -v</span> when available.</p>
        </div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="input-field !pl-10 w-full"
          placeholder="Search volumes..."
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
            <Database className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No volumes found</h3>
          <p className="text-muted-foreground text-sm">No volumes match your search, or the engine returned an empty list.</p>
        </div>
      ) : currentData ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="w-12 py-3 px-3" />
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Size</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created at</th>
                <th className="py-3 px-5 w-14" />
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors group"
                >
                  <td className="py-3.5 px-3 w-12 align-middle">
                    <DockerBulkCheckbox
                      checked={bulk.selected.has(v.name)}
                      onCheckedChange={() => bulk.toggle(v.name)}
                      aria-label={`Select volume ${v.name}`}
                    />
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <Database className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                      <span className="font-mono text-sm font-medium">{v.name}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <HardDrive className="w-3.5 h-3.5 shrink-0" />
                      {v.size}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      {formatCreatedAt(v.createdAt)}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setForceDialog(v.name)}
                        disabled={del.isPending || forcePending === v.name}
                        className="p-1.5 rounded-md hover:bg-amber-500/15 text-muted-foreground hover:text-amber-500"
                        title="Force delete volume"
                      >
                        {forcePending === v.name ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <OctagonAlert className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(v.name)}
                        disabled={del.isPending || forcePending === v.name}
                        className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                        title="Delete volume"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ListPagination
            page={currentData.page}
            totalPages={totalPages}
            onPageChange={setPage}
            from={from}
            to={to}
            total={currentData.total}
            className="px-5 pb-4"
          />
        </div>
      ) : null}
      <AlertDialog open={!!forceDialog} onOpenChange={(open) => !open && setForceDialog(null)}>
        <AlertDialogContent className="max-w-lg border-amber-500/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-500">
              <OctagonAlert className="w-5 h-5 shrink-0" />
              Force delete volume
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-muted-foreground">
                <p>
                  This runs <strong className="text-foreground">docker volume rm -f</strong> using the volume name.
                </p>
                <p>
                  If Docker still reports this volume in use, remove containers that reference it first, then retry.
                </p>
                {forceDialog && (
                  <div>
                    <span className="text-xs font-medium text-foreground">Command on the API host:</span>
                    <code className="mt-1 block w-full rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 text-[11px] font-mono text-zinc-200 break-all">
                      docker volume rm -f {forceDialog}
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
