"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Search, HardDrive, Tag, Clock, Loader2, AlertCircle, Trash2, OctagonAlert } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  DOCKER_API_HELP,
  deleteDockerImage,
  dockerPagedWsUrl,
  dockerImageDeleteRef,
  dockerImageForceDeleteRef,
  type DockerImage,
} from "@/lib/docker-api";
import { fetchDockerImagesPagedBrowser } from "@/lib/docker-paged-browser";
import {
  deleteRemoteConsoleImage,
  fetchRemoteConsoleImagesPaged,
} from "@/lib/remote-console-api";
import { DOCKER_LIST_PAGE_SIZE, type PaginatedImagesResponse } from "@/lib/docker-paged-fetch";
import type { DockerConsoleTarget } from "@/lib/console-target";
import { useToast } from "@/hooks/use-toast";
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
import { useConfirm } from "@/components/confirm/ConfirmProvider";

function formatCreated(value: string) {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return format(d, "MMM d, yyyy");
  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}

type Props = {
  consoleTarget: DockerConsoleTarget;
  urlPage: number;
  urlQ: string;
};

export function DockerImagesClient({ consoleTarget, urlPage, urlQ }: Props) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const { page, q, localQ, setLocalQ, setPage } = useDockerListUrl(urlPage, urlQ);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [bulkPending, setBulkPending] = useState(false);
  const [forceDialog, setForceDialog] = useState<DockerImage | null>(null);

  const listQuery = useQuery({
    queryKey: ["console", "images", consoleTarget, page, q],
    queryFn: async () => {
      if (consoleTarget === "local") {
        return fetchDockerImagesPagedBrowser(page, DOCKER_LIST_PAGE_SIZE, q);
      }
      if (!accessToken) throw new Error("Sign in required");
      return fetchRemoteConsoleImagesPaged(
        accessToken,
        consoleTarget,
        page,
        DOCKER_LIST_PAGE_SIZE,
        q,
      );
    },
    enabled: consoleTarget === "local" || Boolean(accessToken),
  });

  const liveData = listQuery.data ?? null;
  const liveError = listQuery.error
    ? listQuery.error instanceof Error
      ? listQuery.error.message
      : String(listQuery.error)
    : null;

  useEffect(() => {
    if (consoleTarget !== "local") return;
    let disposed = false;
    let ws: WebSocket | null = null;
    const connect = () => {
      ws = new WebSocket(
        dockerPagedWsUrl({
          topic: "images.paged",
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
          if (msg.type === "images.paged" && msg.data) {
            qc.setQueryData(
              ["console", "images", "local", page, q],
              msg.data as PaginatedImagesResponse,
            );
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
  }, [consoleTarget, page, q, qc]);

  const currentData = liveData;
  const items = currentData?.items ?? [];
  const filteredKeys = useMemo(() => items.map((img) => img.id), [items]);
  const bulk = useBulkSelection(filteredKeys);

  const totalPages = currentData ? Math.max(1, Math.ceil(currentData.total / currentData.pageSize)) : 1;
  const from = currentData && currentData.total > 0 ? (currentData.page - 1) * currentData.pageSize + 1 : 0;
  const to = currentData ? Math.min(currentData.page * currentData.pageSize, currentData.total) : 0;

  const handleBulkDelete = async () => {
    const targets = items.filter((img) => bulk.selectedInFiltered.includes(img.id));
    if (targets.length === 0) return;
    const confirmed = await confirm({
      title: "Remove selected images?",
      description: `Remove ${targets.length} image(s)? Containers using an image may block removal.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBulkPending(true);
    const results = await Promise.allSettled(
      targets.map((img) => {
        const ref = dockerImageDeleteRef(img);
        return consoleTarget === "local"
          ? deleteDockerImage(ref)
          : deleteRemoteConsoleImage(accessToken ?? "", consoleTarget as number, ref);
      }),
    );
    setBulkPending(false);
    const removed = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - removed;
    const firstReject = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    const firstErr =
      firstReject?.reason instanceof Error
        ? firstReject.reason.message
        : firstReject
          ? String(firstReject.reason)
          : "";
    bulk.clear();
    void listQuery.refetch();
    toast({
      title: fail === results.length ? "Could not remove images" : "Bulk remove finished",
      description:
        fail > 0
          ? `${removed} removed, ${fail} failed.${firstErr ? ` ${firstErr}` : ""}`
          : `${removed} removed.`,
      variant: fail ? "destructive" : "default",
    });
  };

  const handleDelete = async (img: DockerImage) => {
    const ref = dockerImageDeleteRef(img);
    const ok = await confirm({
      title: "Remove image?",
      description: `Remove ${ref}? Containers using it may block removal.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    (async () => {
      try {
        if (consoleTarget === "local") {
          await deleteDockerImage(ref);
        } else {
          await deleteRemoteConsoleImage(accessToken ?? "", consoleTarget as number, ref);
        }
        toast({ title: "Image removed", description: ref });
        void listQuery.refetch();
      } catch (e) {
        toast({
          title: "Could not remove image",
          description: e instanceof Error ? e.message : "Unknown error from the API.",
          variant: "destructive",
        });
      }
    })();
  };

  const forceDeleteRef = forceDialog ? dockerImageForceDeleteRef(forceDialog) : "";
  const forceDeleteCmd = forceDeleteRef ? `docker rmi -f ${forceDeleteRef}` : "";

  const runForceDelete = () => {
    if (!forceDialog) return;
    const ref = dockerImageForceDeleteRef(forceDialog);
    void (async () => {
      try {
        if (consoleTarget === "local") {
          await deleteDockerImage(ref);
        } else {
          await deleteRemoteConsoleImage(accessToken ?? "", consoleTarget as number, ref);
        }
        toast({ title: "Image removed (force)", description: ref });
        setForceDialog(null);
        void listQuery.refetch();
      } catch (e) {
        toast({
          title: "Could not remove image",
          description: e instanceof Error ? e.message : "Unknown error from the API.",
          variant: "destructive",
        });
        setForceDialog(null);
      }
    })();
  };

  const listError = liveError;
  const isError = !!listError;

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-3xl font-bold">Docker Images</h1>
          <p className="text-muted-foreground text-sm mt-1">Live data from Docker via the API (server-paged).</p>
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
            <p className="font-medium text-destructive">Could not load images</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{listError}</p>
            <p className="text-muted-foreground text-xs mt-2">{DOCKER_API_HELP}</p>
          </div>
        </div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="input-field !pl-10 w-full"
          placeholder="Search images..."
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
            <ImageIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No images found</h3>
          <p className="text-muted-foreground text-sm">No images match your search, or the engine returned an empty list.</p>
        </div>
      ) : currentData ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="w-12 py-3 px-3" />
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Repository</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tag</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Image ID</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Size</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                <th className="py-3 px-5 w-[5.5rem] text-right" />
              </tr>
            </thead>
            <tbody>
              {items.map((img) => (
                <tr
                  key={img.id}
                  className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors group"
                >
                  <td className="py-3.5 px-3 w-12 align-middle">
                    <DockerBulkCheckbox
                      checked={bulk.selected.has(img.id)}
                      onCheckedChange={() => bulk.toggle(img.id)}
                      aria-label={`Select ${img.repository}:${img.tag}`}
                    />
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <ImageIcon className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <span className="font-medium text-sm">{img.repository}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="bg-primary/10 text-primary border border-primary/20 text-xs rounded-full px-2 py-0.5 font-mono flex items-center gap-1 w-fit">
                      <Tag className="w-3 h-3" />
                      {img.tag}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="font-mono text-xs text-muted-foreground">{img.imageId}</span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <HardDrive className="w-3.5 h-3.5" />
                      {img.size}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      {formatCreated(img.createdAt)}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => setForceDialog(img)}
                        disabled={listQuery.isFetching}
                        className="p-1.5 rounded-md hover:bg-amber-500/15 text-muted-foreground hover:text-amber-500"
                        title="Force delete by image ID (dangerous)"
                      >
                        <OctagonAlert className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(img)}
                        disabled={listQuery.isFetching}
                        className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                        title="Remove image (repo:tag)"
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
              Force delete by image ID
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-muted-foreground">
                <p>
                  This runs <strong className="text-foreground">docker rmi -f</strong> using the image digest (ID). It can remove
                  this layer even when tagged under other names, and may affect multiple tags pointing at the same ID.
                </p>
                <p>
                  If a <strong className="text-foreground">running or stopped container</strong> still references this image,
                  Docker may refuse removal — stop/remove those containers first.
                </p>
                {forceDeleteCmd && (
                  <div>
                    <span className="text-xs font-medium text-foreground">Command on the API host:</span>
                    <code className="mt-1 block w-full rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 text-[11px] font-mono text-zinc-200 break-all">
                      {forceDeleteCmd}
                    </code>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={listQuery.isFetching}>Cancel</AlertDialogCancel>
            <button
              type="button"
              disabled={listQuery.isFetching}
              className={cn(buttonVariants({ variant: "destructive" }), "gap-2")}
              onClick={runForceDelete}
            >
              {listQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirm force delete
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
