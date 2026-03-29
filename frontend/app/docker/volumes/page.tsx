"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { Database, Search, HardDrive, Clock, RefreshCw, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDockerVolumes, useDeleteDockerVolume } from "@/hooks/use-docker";
import { DOCKER_API_HELP, deleteDockerVolume } from "@/lib/docker-api";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";

function formatCreatedAt(value: string) {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return format(d, "MMM d, yyyy HH:mm");
  const t = value.trim();
  return t.length > 22 ? `${t.slice(0, 22)}…` : t || "—";
}

export default function DockerVolumes() {
  const { data: volumes = [], isLoading, isError, error, refetch, isFetching } = useDockerVolumes();
  const del = useDeleteDockerVolume();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [bulkPending, setBulkPending] = useState(false);

  const filtered = useMemo(
    () => volumes.filter((v) => v.name.toLowerCase().includes(search.toLowerCase())),
    [volumes, search],
  );

  const filteredKeys = useMemo(() => filtered.map((v) => v.name), [filtered]);
  const bulk = useBulkSelection(filteredKeys);

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
    await refetch();
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
      onSuccess: () => toast({ title: "Volume removed", description: name }),
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const totalSize = volumes.length;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Docker Volumes</h1>
          <p className="text-muted-foreground text-sm mt-1">Live data from Docker via the API.</p>
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
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {isError && (
        <div className="glass-panel rounded-xl p-4 mb-6 border border-destructive/30 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Could not load volumes</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{error instanceof Error ? error.message : "Unknown error"}</p>
            <p className="text-muted-foreground text-xs mt-2">{DOCKER_API_HELP}</p>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-xl p-4 mb-6 max-w-md">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total volumes</p>
        <p className="text-2xl font-bold text-primary">{totalSize}</p>
        <p className="text-xs text-muted-foreground mt-2">Size comes from <span className="font-mono">docker system df -v</span> when available.</p>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="input-field !pl-10 w-full"
          placeholder="Search volumes..."
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
          <p className="text-sm">Loading volumes…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <Database className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No volumes found</h3>
          <p className="text-muted-foreground text-sm">No volumes match your search, or the engine returned an empty list.</p>
        </div>
      ) : (
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
              {filtered.map((v, i) => (
                <motion.tr
                  key={v.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
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
                    <button
                      type="button"
                      onClick={() => handleDelete(v.name)}
                      disabled={del.isPending}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                      title="Delete volume"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  );
}
