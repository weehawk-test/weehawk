"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Network, Search, Clock, Loader2, AlertCircle, Trash2, OctagonAlert, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { DOCKER_API_HELP } from "@/lib/docker-api";
import type { DockerConsoleTarget } from "@/lib/console-target";
import {
  deleteRemoteConsoleNetwork,
  fetchRemoteConsoleNetworksPaged,
} from "@/lib/remote-console-api";
import { DOCKER_LIST_PAGE_SIZE } from "@/lib/docker-paged-fetch";
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
  consoleTarget: DockerConsoleTarget;
  urlPage: number;
  urlQ: string;
};

export function DockerNetworksClient({ consoleTarget, urlPage, urlQ }: Props) {
  const { accessToken } = useAuth();
  const { page, q, localQ, setLocalQ, setPage } = useDockerListUrl(urlPage, urlQ);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [bulkPending, setBulkPending] = useState(false);
  const [forcePending, setForcePending] = useState<string | null>(null);
  const [forceDialog, setForceDialog] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["console", "networks", consoleTarget, page, q],
    queryFn: async () => {
      if (!accessToken) throw new Error("Sign in required");
      return fetchRemoteConsoleNetworksPaged(
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

  const currentData = liveData;
  const items = currentData?.items ?? [];
  const filteredKeys = useMemo(() => items.map((n) => n.name), [items]);
  const bulk = useBulkSelection(filteredKeys);

  const totalPages = currentData ? Math.max(1, Math.ceil(currentData.total / currentData.pageSize)) : 1;
  const from = currentData && currentData.total > 0 ? (currentData.page - 1) * currentData.pageSize + 1 : 0;
  const to = currentData ? Math.min(currentData.page * currentData.pageSize, currentData.total) : 0;
  const totalAll = currentData?.totalAll ?? 0;

  const handleBulkDelete = async () => {
    const names = bulk.selectedInFiltered;
    if (names.length === 0) return;
    const confirmed = await confirm({
      title: "Remove selected networks?",
      description: `Remove ${names.length} network(s)? Fails if containers still use a network or the network is predefined (e.g. bridge).`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBulkPending(true);
    const results = await Promise.allSettled(
      names.map((n) => deleteRemoteConsoleNetwork(accessToken ?? "", consoleTarget, n)),
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

  const handleDelete = async (name: string) => {
    const ok = await confirm({
      title: "Remove network?",
      description: `Remove “${name}”? This fails if containers still use it or it is a default network.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    void (async () => {
      try {
        await deleteRemoteConsoleNetwork(accessToken ?? "", consoleTarget, name);
        toast({ title: "Network removed", description: name });
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
    setForcePending(forceDialog);
    try {
      await deleteRemoteConsoleNetwork(accessToken ?? "", consoleTarget, forceDialog);
      toast({ title: "Network removed (force)", description: forceDialog });
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

  const listError = liveError;
  const isError = !!listError;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Docker Networks</h1>
          <p className="text-muted-foreground text-sm mt-1">
            <span className="font-mono text-xs">docker network ls</span> via the API (server-paged). Use Refresh to update.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bulk.selectedInFiltered.length > 0 && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkPending || listQuery.isFetching}
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
            <p className="font-medium text-destructive">Could not load networks</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{listError}</p>
            <p className="text-muted-foreground text-xs mt-2">{DOCKER_API_HELP}</p>
          </div>
        </div>
      )}

      {!isError && currentData && (
        <div className="glass-panel rounded-xl p-4 mb-6 max-w-md">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total networks</p>
          <p className="text-2xl font-bold text-primary">{totalAll}</p>
        </div>
      )}

      <div className="flex gap-2 items-stretch mb-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            className="input-field !pl-10 w-full"
            placeholder="Search by name, driver, scope, or id…"
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
            <Network className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No networks found</h3>
          <p className="text-muted-foreground text-sm">No networks match your search, or the engine returned an empty list.</p>
        </div>
      ) : currentData ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="w-12 py-3 px-3" />
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Network ID</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Driver</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scope</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Flags</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                <th className="py-3 px-5 w-14" />
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr
                  key={n.id}
                  className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors group"
                >
                  <td className="py-3.5 px-3 w-12 align-middle">
                    <DockerBulkCheckbox
                      checked={bulk.selected.has(n.name)}
                      onCheckedChange={() => bulk.toggle(n.name)}
                      aria-label={`Select network ${n.name}`}
                    />
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                        <Network className="w-3.5 h-3.5 text-sky-400" />
                      </div>
                      <span className="font-mono text-sm font-medium">{n.name}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="font-mono text-xs text-muted-foreground">{n.networkIdShort}</span>
                  </td>
                  <td className="py-3.5 px-5 text-sm text-muted-foreground">{n.driver}</td>
                  <td className="py-3.5 px-5 text-sm text-muted-foreground">{n.scope}</td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs text-muted-foreground">
                      {[n.internal && "internal", n.ipv6 && "IPv6"].filter(Boolean).join(", ") || "—"}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      {formatCreatedAt(n.createdAt)}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setForceDialog(n.name)}
                        disabled={listQuery.isFetching || forcePending === n.name}
                        className="p-1.5 rounded-md hover:bg-amber-500/15 text-muted-foreground hover:text-amber-500"
                        title="Force remove network"
                      >
                        {forcePending === n.name ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <OctagonAlert className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(n.name)}
                        disabled={listQuery.isFetching || forcePending === n.name}
                        className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                        title="Remove network"
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
              Force delete network
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-muted-foreground">
                <p>
                  This force flow tries to detach Docker services from this network, then runs{" "}
                  <strong className="text-foreground">docker network rm</strong>.
                </p>
                <p>
                  If running containers are still attached, Docker may refuse removal. Disconnect or remove those
                  containers first.
                </p>
                {forceDialog && (
                  <div>
                    <span className="text-xs font-medium text-foreground">Command on the API host:</span>
                    <code className="mt-1 block w-full rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 text-[11px] font-mono text-zinc-200 break-all">
                      docker network rm {forceDialog}
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
    </>
  );
}
