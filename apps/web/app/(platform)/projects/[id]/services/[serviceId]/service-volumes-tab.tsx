"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { HardDrive, Loader2, AlertCircle, RefreshCw, FolderOpen, Lock, Archive } from "lucide-react";
import { motion } from "framer-motion";
import { useServiceVolumes } from "@/hooks/use-services";
import { invalidateServiceScopedQueries } from "@/lib/invalidate-service-queries";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { isCloudEdition } from "@/lib/weehawk-edition";

type Props = {
  serviceId: string;
  enabled: boolean;
};

function mountTypeLabel(t: string) {
  if (t === "bind") return "Bind";
  if (t === "volume") return "Named volume";
  if (t === "tmpfs") return "tmpfs";
  return t;
}

function rowSupportsBackup(mountType: string): boolean {
  return mountType !== "tmpfs";
}

export function ServiceVolumesTab({ serviceId, enabled }: Props) {
  const showLocalDockerVolumesLink = !isCloudEdition();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data, isLoading, isFetching, refetch } = useServiceVolumes(serviceId, enabled);

  const handleBackupPlaceholder = (label: string) => {
    toast({
      title: "Backup",
      description: `Backup for “${label}” is not implemented yet. This action will be wired up in a future update.`,
    });
  };

  const refresh = () => {
    void refetch();
    void invalidateServiceScopedQueries(qc, serviceId, user?.userId ?? "none");
  };

  if (!enabled) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Volume and bind mounts declared in this service&apos;s compose file (resolved on the API host via{" "}
          <code className="text-xs bg-muted px-1 rounded">docker compose config</code>
          ). Named volumes show the Docker volume name the engine will create (e.g.{" "}
          <span className="font-mono text-xs">project_volname</span>).
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => refresh()}
            disabled={isFetching}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
          {showLocalDockerVolumesLink ? (
            <Link href="/console/local/volumes" prefetch={false}>
              <button type="button" className="btn-primary flex items-center gap-2 text-sm">
                <HardDrive className="w-4 h-4" />
                Docker volumes
              </button>
            </Link>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Loading volume mounts…</span>
        </div>
      ) : data?.error ? (
        <div className="glass-panel rounded-xl p-4 border border-destructive/30 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Could not resolve compose volumes</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{data.error}</p>
          </div>
        </div>
      ) : !data?.items.length ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <div className="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <HardDrive className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No volume mounts in compose</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Add a <span className="font-mono">volumes:</span> section under a service in the Configuration tab, or define top-level named volumes.
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Compose service
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Access</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Host volume</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">
                  Backup
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row, i) => (
                <motion.tr
                  key={`${row.composeService}-${row.source}-${row.target}-${i}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                >
                  <td className="py-3.5 px-5">
                    <span className="font-mono text-sm text-primary font-medium">{row.composeService}</span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs text-muted-foreground">{mountTypeLabel(row.mountType)}</span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs font-mono text-muted-foreground break-all">{row.source}</span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="text-xs font-mono text-muted-foreground">{row.target}</span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {row.readOnly ? (
                        <>
                          <Lock className="w-3 h-3" /> read-only
                        </>
                      ) : (
                        "read-write"
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    {row.hostVolumeName ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                        <FolderOpen className="w-3.5 h-3.5 shrink-0 opacity-70" />
                        {row.hostVolumeName}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-5">
                    {rowSupportsBackup(row.mountType) ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleBackupPlaceholder(row.hostVolumeName || row.source || row.target)
                        }
                        className="btn-secondary text-xs py-1.5 px-2.5 inline-flex items-center gap-1.5"
                        title="Backup (coming soon)"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        Backup
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
