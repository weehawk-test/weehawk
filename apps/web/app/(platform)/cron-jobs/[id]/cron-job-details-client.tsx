"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Bell, Clock, Hash, Trash2, Pencil, Terminal, Activity } from "lucide-react";
import { format } from "date-fns";
import { createPortal } from "react-dom";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useDeleteCronJob, useUpdateCronJob } from "@/hooks/use-cron-jobs";
import type { CronJobDetail } from "@/lib/cron-jobs-api";
import { VolumeBackupDbWarning } from "@/components/volume-backup-db-warning";
import { motion } from "framer-motion";

type Props = {
  initialCronJob: CronJobDetail;
};

export function CronJobDetailsClient({ initialCronJob }: Props) {
  const router = useRouter();
  const cronJob = initialCronJob;
  const { toast } = useToast();
  const confirm = useConfirm();
  const deleteMutation = useDeleteCronJob();
  const updateMutation = useUpdateCronJob();

  if (typeof document === "undefined") return null;

  const closeModal = () => {
    if (updateMutation.isPending || deleteMutation.isPending) return;
    router.push("/cron-jobs");
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-start justify-center px-4 py-6 md:px-6 md:py-8"
      onClick={closeModal}
    >
      <div className="w-full max-w-3xl mx-auto relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => router.push("/cron-jobs")}
          className="absolute top-0 right-0 z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6 pr-12">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{cronJob.name}</h1>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                  cronJob.isActive
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-muted text-muted-foreground border border-white/5"
                }`}
              >
                {cronJob.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="text-muted-foreground text-base">
              {cronJob.description?.trim() || "No description"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/cron-jobs/${cronJob.id}/edit`}>
              <button type="button" className="btn-secondary whitespace-nowrap flex items-center gap-2">
                <Pencil className="w-4 h-4" /> Edit
              </button>
            </Link>
            <button
              type="button"
              onClick={() =>
                updateMutation.mutate(
                  { id: cronJob.id, isActive: !cronJob.isActive },
                  {
                    onSuccess: (updated) => {
                      toast({
                        title: updated.isActive ? "Activated" : "Deactivated",
                        description: updated.isActive
                          ? "This schedule will run again."
                          : "This schedule is paused.",
                      });
                      router.refresh();
                    },
                    onError: (e: Error) =>
                      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
                  },
                )
              }
              disabled={updateMutation.isPending}
              className="btn-secondary"
            >
              {cronJob.isActive ? "Deactivate" : "Activate"}
            </button>
          </div>
        </div>

        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="glass-panel p-1 rounded-2xl mb-6 relative group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />
          <div className="bg-background rounded-xl p-5 relative z-10">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              <Clock className="w-3.5 h-3.5" />
              Cron Schedule
            </label>
            <div className="font-mono text-primary text-sm break-all selection:bg-primary/30 leading-relaxed">
              {cronJob.cronExpression}
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="glass-panel p-4 rounded-2xl max-h-[62vh] overflow-y-auto">
            {cronJob.serviceAction !== "docker_command" && (
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Terminal className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base">Target</h3>
              </div>
            )}
            <div className="space-y-2.5 text-sm">
              {!(cronJob.serviceAction === "docker_command") && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Action</p>
                  <p className="font-medium text-foreground">{cronJob.serviceAction ?? cronJob.targetMode}</p>
                </div>
              )}
              {cronJob.targetMode === "service" && cronJob.serviceAction !== "docker_command" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Service ID</p>
                  <p className="font-mono">{cronJob.serviceId ?? "—"}</p>
                </div>
              )}
              {cronJob.volumeSource && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Volume</p>
                  <p className="font-mono text-xs break-all">{cronJob.volumeSource}</p>
                  {cronJob.serviceAction === "volume_backup" && (
                    <VolumeBackupDbWarning className="mt-2" />
                  )}
                </div>
              )}
              {cronJob.serviceAction === "database_backup" && cronJob.databaseBackupPreview && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">What will run</p>
                  <p className="font-mono text-xs text-foreground/95 whitespace-pre-wrap break-all leading-relaxed">
                    {cronJob.databaseBackupPreview}
                  </p>
                </div>
              )}
              {cronJob.dockerCommand &&
                (cronJob.serviceAction === "docker_command" ||
                  (cronJob.serviceAction === "database_backup" && !cronJob.databaseBackupConfig)) && (
                  <div>
                    {cronJob.serviceAction === "docker_command" && (
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <Terminal className="w-5 h-5 text-primary" />
                        </div>
                        <h3 className="font-semibold text-base">Bash Script</h3>
                      </div>
                    )}
                    {cronJob.serviceAction === "database_backup" && (
                      <p className="text-xs text-muted-foreground mb-1">Legacy command</p>
                    )}
                    <pre className="bg-black/40 px-3 py-2 rounded-lg border border-white/5 font-mono text-xs whitespace-pre-wrap break-all min-h-[220px] max-h-[46vh] overflow-y-auto">
                      {cronJob.dockerCommand}
                    </pre>
                  </div>
                )}
              {(cronJob.serviceAction === "volume_backup" || cronJob.serviceAction === "database_backup") && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">S3 destination</p>
                  <p className="font-mono text-sm">
                    {cronJob.backupS3ProfileName ?? "Not set — edit and choose a profile"}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl max-h-[62vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-base">Notifications</h3>
            </div>
            <div className="space-y-2.5 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Notification on trigger</p>
                <p className="font-medium text-foreground">{cronJob.notifyChannelId && cronJob.notifyMessage ? "Enabled" : "Off"}</p>
              </div>
              {cronJob.notifyChannelId && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Channel ID</p>
                  <p className="font-mono text-xs break-all">{cronJob.notifyChannelId}</p>
                </div>
              )}
              {cronJob.notifyMessage && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Message</p>
                  <pre className="bg-black/40 px-3 py-2 rounded-lg border border-white/5 font-mono text-xs whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
                    {cronJob.notifyMessage}
                  </pre>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-white/5">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-base">Meta</h3>
            </div>
            <div className="space-y-2.5 text-sm mt-4">
              <div>
                <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" /> ID
                </p>
                <p className="font-mono text-xs break-all">{cronJob.id}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Created
                </p>
                <p className="font-medium text-foreground text-sm">
                  {format(new Date(cronJob.createdAt), "MMMM d, yyyy 'at' h:mm a")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 p-5 border border-destructive/20 bg-destructive/5 rounded-2xl">
          <h3 className="font-bold text-destructive text-base mb-1.5">Danger zone</h3>
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: "Delete this cron job?",
                description: "It will stop running immediately.",
                confirmLabel: "Delete",
                variant: "destructive",
              });
              if (!ok) return;
              deleteMutation.mutate(cronJob.id, {
                onSuccess: () => router.replace("/cron-jobs"),
              });
            }}
            disabled={deleteMutation.isPending}
            className="px-4 py-2.5 bg-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Delete cron job
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
