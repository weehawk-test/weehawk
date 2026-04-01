"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, Clock, Hash, Trash2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useDeleteCronJob, useUpdateCronJob } from "@/hooks/use-cron-jobs";
import type { CronJobDetail } from "@/lib/cron-jobs-api";

type Props = {
  id: string;
  initialCronJob: CronJobDetail;
};

export function CronJobDetailsClient({ id, initialCronJob }: Props) {
  const router = useRouter();
  const cronJob = initialCronJob;
  const { toast } = useToast();
  const confirm = useConfirm();
  const deleteMutation = useDeleteCronJob();
  const updateMutation = useUpdateCronJob();

  return (
    <>
      <div className="max-w-3xl mx-auto">
        <Link href="/cron-jobs">
          <button type="button" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to cron jobs
          </button>
        </Link>

        <div className="flex items-center justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-bold">{cronJob.name}</h1>
            {cronJob.description && <p className="text-muted-foreground">{cronJob.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/cron-jobs/${id}/edit`}>
              <button type="button" className="btn-secondary whitespace-nowrap flex items-center gap-2">
                <Pencil className="w-4 h-4" /> Edit
              </button>
            </Link>
            <button
              type="button"
              onClick={() =>
                updateMutation.mutate(
                  { id, isActive: !cronJob.isActive },
                  {
                    onSuccess: (updated) => {
                      toast({ title: updated.isActive ? "Activated" : "Deactivated" });
                      router.refresh();
                    },
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

        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Cron expression</p>
            <p className="font-mono text-primary">{cronJob.cronExpression}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Action</p>
            <p>{cronJob.serviceAction ?? cronJob.targetMode}</p>
          </div>
          {cronJob.targetMode === "service" && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Service ID</p>
              <p className="font-mono">{cronJob.serviceId ?? "—"}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t border-white/5">
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Hash className="w-3 h-3" /> ID</p>
              <p className="font-mono text-xs break-all">{cronJob.id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Created</p>
              <p>{format(new Date(cronJob.createdAt), "MMM d, yyyy HH:mm")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Bell className="w-3 h-3" /> Notifications</p>
              <p>{cronJob.notifyChannelId && cronJob.notifyMessage ? "Enabled" : "Off"}</p>
            </div>
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
              <pre className="bg-black/40 px-3 py-2 rounded-lg border border-white/5 font-mono text-xs whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {cronJob.notifyMessage}
              </pre>
            </div>
          )}
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
              deleteMutation.mutate(id, {
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
    </>
  );
}
