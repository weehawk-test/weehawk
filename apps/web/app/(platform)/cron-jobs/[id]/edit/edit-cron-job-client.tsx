"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUpdateCronJob } from "@/hooks/use-cron-jobs";
import type { CronJobDetail } from "@/lib/cron-jobs-api";
import type { NotificationChannel } from "@/lib/notifications-api";
import type { S3ProfilePublic } from "@/lib/s3-api";
import type { Service } from "@/lib/schema";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DatabaseBackupFormFields } from "@/components/database-backup-form-fields";
import { VolumeBackupDbWarning } from "@/components/volume-backup-db-warning";
import {
  resolveBackupFormat,
  validateDatabaseBackupForm,
  type DatabaseBackupFormValues,
} from "@/lib/database-backup-preview";
import type { DatabaseBackupConfig } from "@/lib/cron-jobs-api";

function backupConfigToForm(cfg: DatabaseBackupConfig | null): DatabaseBackupFormValues {
  return {
    engine: cfg?.engine ?? "postgres",
    composeService: cfg?.composeService ?? "",
    databaseName: cfg?.databaseName ?? "",
    dbUser: cfg?.dbUser ?? "",
    backupFormat: cfg?.backupFormat,
  };
}

type Props = {
  id: string;
  initialCronJob: CronJobDetail;
  initialChannels: NotificationChannel[];
  initialS3Profiles: S3ProfilePublic[];
  initialServices: Service[];
};

export function EditCronJobClient({
  id,
  initialCronJob,
  initialChannels,
  initialS3Profiles,
  initialServices,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const updateMutation = useUpdateCronJob();

  const [name, setName] = useState(initialCronJob.name);
  const [description, setDescription] = useState(initialCronJob.description ?? "");
  const [cronExpression, setCronExpression] = useState(initialCronJob.cronExpression ?? "");
  const [notifyChannelId, setNotifyChannelId] = useState(initialCronJob.notifyChannelId ?? "");
  const [notifyMessage, setNotifyMessage] = useState(initialCronJob.notifyMessage ?? "");
  const [backupS3ProfileName, setBackupS3ProfileName] = useState(
    initialCronJob.backupS3ProfileName ?? "",
  );
  const [dbBackup, setDbBackup] = useState<DatabaseBackupFormValues>(() =>
    backupConfigToForm(initialCronJob.databaseBackupConfig),
  );

  const selectedService = useMemo(() => {
    const sid = initialCronJob.serviceId;
    if (sid == null) return null;
    return initialServices.find((s) => Number(s.id) === sid) ?? null;
  }, [initialServices, initialCronJob.serviceId]);

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!cronExpression.trim()) {
      toast({ title: "Cron expression required", variant: "destructive" });
      return;
    }
    const hasNotifyChannel = Boolean(notifyChannelId.trim());
    const hasNotifyMessage = Boolean(notifyMessage.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      toast({ title: "Choose channel and message together", variant: "destructive" });
      return;
    }

    const backup =
      initialCronJob.serviceAction === "volume_backup" ||
      initialCronJob.serviceAction === "database_backup";
    if (backup && initialS3Profiles.length === 0) {
      toast({
        title: "Add an S3 destination first",
        description: "Backups require a saved S3 profile.",
        variant: "destructive",
      });
      return;
    }
    if (backup && !backupS3ProfileName.trim()) {
      toast({
        title: "S3 destination required",
        description: "Choose which saved S3 profile to use.",
        variant: "destructive",
      });
      return;
    }
    if (initialCronJob.serviceAction === "database_backup") {
      const v = validateDatabaseBackupForm(dbBackup);
      if (!v.ok) {
        toast({ title: "Database backup", description: v.message, variant: "destructive" });
        return;
      }
    }

    updateMutation.mutate(
      {
        id,
        name: name.trim(),
        description: description.trim(),
        cronExpression: cronExpression.trim(),
        notifyChannelId: hasNotifyChannel ? notifyChannelId : null,
        notifyMessage: hasNotifyMessage ? notifyMessage.trim() : null,
        ...(backup
          ? {
              backupS3ProfileName: backupS3ProfileName.trim() || null,
            }
          : {}),
        ...(initialCronJob.serviceAction === "database_backup"
          ? {
              databaseBackupConfig: {
                engine: dbBackup.engine,
                composeService: dbBackup.composeService.trim(),
                backupFormat: resolveBackupFormat(dbBackup.engine, dbBackup.backupFormat),
                ...(dbBackup.engine !== "redis"
                  ? { databaseName: dbBackup.databaseName.trim() }
                  : {}),
                ...(dbBackup.dbUser.trim() ? { dbUser: dbBackup.dbUser.trim() } : {}),
              },
            }
          : {}),
      },
      {
        onSuccess: () => router.push(`/cron-jobs/${id}`),
        onError: (e: Error) =>
          toast({ title: "Could not update cron job", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <>
      <div className="max-w-2xl mx-auto">
        <Link href="/cron-jobs">
          <button type="button" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to cron jobs
          </button>
        </Link>

        <div className="glass-panel p-6 md:p-8 rounded-2xl">
          <h1 className="text-2xl font-bold text-foreground mb-6">Edit cron job</h1>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name</label>
              <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <textarea className="input-field min-h-[80px] resize-y" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Cron expression</label>
              <input className="input-field font-mono text-sm" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} />
            </div>
            {initialCronJob.serviceAction === "database_backup" && (
              <div className="rounded-xl border border-white/10 p-4 space-y-3">
                <p className="text-sm font-medium">Backup options</p>
                {!initialCronJob.databaseBackupConfig && (
                  <p className="text-xs text-amber-400/90">
                    This job used a legacy Docker command. Set engine and service below so backups use the
                    structured runner; the old command is shown on the detail page until then.
                  </p>
                )}
                <DatabaseBackupFormFields
                  service={
                    selectedService?.type === "databases" ? selectedService : null
                  }
                  values={dbBackup}
                  onChange={(patch) => setDbBackup((prev) => ({ ...prev, ...patch }))}
                  onReplaceValues={setDbBackup}
                />
              </div>
            )}
            {(initialCronJob.serviceAction === "volume_backup" ||
              initialCronJob.serviceAction === "database_backup") && (
              <div className="rounded-xl border border-white/10 p-4 space-y-3">
                {initialCronJob.serviceAction === "volume_backup" && (
                  <VolumeBackupDbWarning className="mb-1" />
                )}
                <p className="text-sm font-medium">Backup destination</p>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">S3 destination (required)</label>
                  <select
                    className="input-field"
                    value={backupS3ProfileName}
                    onChange={(e) => setBackupS3ProfileName(e.target.value)}
                    required
                  >
                    <option value="">Select S3 profile…</option>
                    {initialS3Profiles.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} — {p.bucket}
                      </option>
                    ))}
                  </select>
                  {initialS3Profiles.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      <Link href="/s3" className="text-primary hover:underline">
                        Add an S3 destination
                      </Link>
                    </p>
                  ) : null}
                </div>
              </div>
            )}
            <div className="rounded-xl border border-white/10 p-4 space-y-3">
              <p className="text-sm font-medium">Optional notification</p>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notification channel</label>
                <select className="input-field" value={notifyChannelId} onChange={(e) => setNotifyChannelId(e.target.value)}>
                  <option value="">No notification</option>
                  {initialChannels.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Message content</label>
                <textarea className="input-field min-h-[80px] resize-y" value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Link href="/cron-jobs"><button type="button" className="btn-secondary">Cancel</button></Link>
              <button type="button" onClick={submit} disabled={updateMutation.isPending} className="btn-primary">
                {updateMutation.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
