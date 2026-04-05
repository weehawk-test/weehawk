"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCreateCronJob } from "@/hooks/use-cron-jobs";
import { type WebhookServiceAction, type WebhookTargetMode } from "@/lib/webhooks-api";
import type { Service } from "@/lib/schema";
import type { NotificationChannel } from "@/lib/notifications-api";
import type { S3ProfilePublic } from "@/lib/s3-api";
import { X, Loader2, Terminal, Type, AlignLeft } from "lucide-react";
import { useServiceVolumes } from "@/hooks/use-services";
import { useToast } from "@/hooks/use-toast";
import { DatabaseBackupFormFields } from "@/components/database-backup-form-fields";
import { VolumeBackupDbWarning } from "@/components/volume-backup-db-warning";
import {
  resolveBackupFormat,
  validateDatabaseBackupForm,
  type DatabaseBackupFormValues,
} from "@/lib/database-backup-preview";
import { listDatabaseBackupOptions } from "@/lib/database-backup-from-service";

type Props = {
  initialServices: Service[];
  initialChannels: NotificationChannel[];
  initialS3Profiles: S3ProfilePublic[];
};

type CronPreset =
  | "custom"
  | "every_minute"
  | "every_hour"
  | "every_day_midnight"
  | "every_sunday_midnight"
  | "every_month_1_midnight"
  | "every_15_minutes"
  | "every_weekday_midnight";

export function CreateCronJobClient({ initialServices, initialChannels, initialS3Profiles }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const createMutation = useCreateCronJob();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cronPreset, setCronPreset] = useState<CronPreset>("every_15_minutes");
  const [cronExpression, setCronExpression] = useState("*/15 * * * *");
  const [targetMode] = useState<WebhookTargetMode>("service");
  const [serviceId, setServiceId] = useState("");
  const [serviceAction, setServiceAction] = useState<WebhookServiceAction | "">("");
  const [volumeSource, setVolumeSource] = useState("");
  const [dockerCommand, setDockerCommand] = useState("docker ");
  const [dbBackup, setDbBackup] = useState<DatabaseBackupFormValues>({
    engine: "postgres",
    composeService: "",
    databaseName: "",
    dbUser: "",
    backupFormat: "postgres_sql_gzip",
  });
  const [backupS3ProfileName, setBackupS3ProfileName] = useState("");
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [notifyChannelId, setNotifyChannelId] = useState("");
  const [notifyMessage, setNotifyMessage] = useState("");
  const notificationRequired = serviceAction === "no_action";
  const showNotificationFields = notificationEnabled || notificationRequired;

  const volQuery = useServiceVolumes(
    serviceId || undefined,
    targetMode === "service" && serviceAction === "volume_backup" && Boolean(serviceId),
  );

  const volumeOptions = useMemo(() => {
    const items = volQuery.data?.items ?? [];
    return items.filter((v) => v.mountType === "volume" && v.source && v.source !== "—");
  }, [volQuery.data]);

  const databaseServices = useMemo(
    () => initialServices.filter((s) => s.type === "databases"),
    [initialServices],
  );

  const selectedService = useMemo(
    () => initialServices.find((s) => s.id === serviceId) ?? null,
    [initialServices, serviceId],
  );

  useEffect(() => {
    if (serviceAction !== "database_backup") return;
    if (!serviceId) {
      setDbBackup({
        engine: "postgres",
        composeService: "",
        databaseName: "",
        dbUser: "",
        backupFormat: "postgres_sql_gzip",
      });
      return;
    }
    const svc = selectedService;
    if (!svc || svc.type !== "databases") return;
    const opts = listDatabaseBackupOptions(svc);
    if (opts.length > 0) {
      setDbBackup(opts[0]!.form);
    } else {
      setDbBackup({
        engine: "postgres",
        composeService: "",
        databaseName: "",
        dbUser: "",
        backupFormat: "postgres_sql_gzip",
      });
    }
  }, [serviceAction, serviceId, selectedService]);

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!cronExpression.trim()) {
      toast({ title: "Cron expression required", variant: "destructive" });
      return;
    }
    if (!serviceAction) {
      toast({ title: "Select an action", variant: "destructive" });
      return;
    }
    if (serviceAction !== "no_action" && !serviceId) {
      toast({
        title: serviceAction === "database_backup" ? "Select a database" : "Select a service",
        variant: "destructive",
      });
      return;
    }
    if (serviceAction === "volume_backup" && !volumeSource.trim()) {
      toast({ title: "Select or enter a volume name", variant: "destructive" });
      return;
    }
    if (
      (serviceAction === "volume_backup" ||
        (serviceAction === "database_backup" && Boolean(serviceId))) &&
      initialS3Profiles.length === 0
    ) {
      toast({
        title: "Add an S3 destination first",
        description: "Backups are stored in S3 only. Create a destination under S3.",
        variant: "destructive",
      });
      return;
    }
    if (
      (serviceAction === "volume_backup" ||
        (serviceAction === "database_backup" && Boolean(serviceId))) &&
      !backupS3ProfileName.trim()
    ) {
      toast({
        title: "S3 destination required",
        description: "Choose which saved S3 profile to upload backups to.",
        variant: "destructive",
      });
      return;
    }
    if (serviceAction === "docker_command") {
      const t = dockerCommand.trim();
      if (!t || !t.toLowerCase().startsWith("docker")) {
        toast({
          title: "Docker command required",
          description: "Command must start with docker (e.g. docker compose ps).",
          variant: "destructive",
        });
        return;
      }
    }
    if (serviceAction === "database_backup") {
      const svc = initialServices.find((s) => s.id === serviceId);
      if (!svc || svc.type !== "databases") {
        toast({
          title: "Database service required",
          description: "Choose a Database-type service (your managed DB stack).",
          variant: "destructive",
        });
        return;
      }
      const v = validateDatabaseBackupForm(dbBackup);
      if (!v.ok) {
        toast({ title: "Database backup", description: v.message, variant: "destructive" });
        return;
      }
    }
    const hasNotifyChannel = Boolean(notifyChannelId.trim());
    const hasNotifyMessage = Boolean(notifyMessage.trim());
    if (notificationRequired && (!hasNotifyChannel || !hasNotifyMessage)) {
      toast({ title: "Notification channel and message are required", variant: "destructive" });
      return;
    }
    if (hasNotifyChannel !== hasNotifyMessage) {
      toast({ title: "Choose channel and message together", variant: "destructive" });
      return;
    }

    const parsedServiceId = serviceId ? Number(serviceId) : undefined;
    if (serviceAction !== "no_action" && (!parsedServiceId || !Number.isInteger(parsedServiceId) || parsedServiceId < 1)) {
      toast({ title: "Select a valid service", variant: "destructive" });
      return;
    }

    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        cronExpression: cronExpression.trim(),
        targetMode,
        ...(serviceAction !== "no_action" ? { serviceId: parsedServiceId } : {}),
        serviceAction: serviceAction as WebhookServiceAction,
        ...(serviceAction === "volume_backup" ? { volumeSource: volumeSource.trim() } : {}),
        ...(serviceAction === "docker_command" ? { dockerCommand: dockerCommand.trim() } : {}),
        ...(serviceAction === "database_backup"
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
        ...(serviceAction === "volume_backup" || serviceAction === "database_backup"
          ? { backupS3ProfileName: backupS3ProfileName.trim() }
          : {}),
        ...(hasNotifyChannel && hasNotifyMessage
          ? { notifyChannelId, notifyMessage: notifyMessage.trim() }
          : {}),
      },
      {
        onSuccess: (j) => router.push(`/cron-jobs/${j.id}`),
        onError: (e: Error) =>
          toast({ title: "Could not create cron job", description: e.message, variant: "destructive" }),
      },
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] overflow-y-auto modal-scrim">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="max-w-2xl w-full py-8">
          <div className="glass-panel p-6 md:p-8 rounded-2xl relative overflow-hidden">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-foreground">Create cron job</h1>
            <Link href="/cron-jobs" aria-label="Close">
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </Link>
          </div>

          <div className="space-y-6 relative z-10">
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
                  <Type className="w-4 h-4 text-primary" /> Name
                </label>
                <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nightly deploy" />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
                  <AlignLeft className="w-4 h-4 text-primary" /> Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea className="input-field min-h-[72px] resize-none" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this schedule do?" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cron presets</label>
                <select
                  className="input-field mb-2"
                  value={cronPreset}
                  onChange={(e) => {
                    const nextPreset = e.target.value as CronPreset;
                    setCronPreset(nextPreset);
                    if (nextPreset === "custom") {
                      // Default cron for manual editing mode.
                      setCronExpression("");
                      return;
                    }
                    const presetById: Record<Exclude<CronPreset, "custom">, string> = {
                      every_minute: "* * * * *",
                      every_hour: "0 * * * *",
                      every_day_midnight: "0 0 * * *",
                      every_sunday_midnight: "0 0 * * 0",
                      every_month_1_midnight: "0 0 1 * *",
                      every_15_minutes: "*/15 * * * *",
                      every_weekday_midnight: "0 0 * * 1-5",
                    };
                    setCronExpression(presetById[nextPreset]);
                  }}
                >
                  <option value="every_minute">Every minute (* * * * *)</option>
                  <option value="every_hour">Every hour (0 * * * *)</option>
                  <option value="every_day_midnight">Every day at midnight (0 0 * * *)</option>
                  <option value="every_sunday_midnight">Every Sunday at midnight (0 0 * * 0)</option>
                  <option value="every_month_1_midnight">Every month on the 1st at midnight (0 0 1 * *)</option>
                  <option value="every_15_minutes">Every 15 minutes (*/15 * * * *)</option>
                  <option value="every_weekday_midnight">Every weekday at midnight (0 0 * * 1-5)</option>
                  <option value="custom">Custom</option>
                </select>

                {cronPreset === "custom" && (
                  <>
                    <label className="text-xs text-muted-foreground mb-1 block">Cron expression</label>
                    <input
                      className="input-field font-mono text-sm"
                      value={cronExpression}
                      onChange={(e) => setCronExpression(e.target.value)}
                      placeholder="0 * * * *"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4">
              <p className="text-sm font-medium text-foreground">Action when triggered</p>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Action</label>
                <select
                  className="input-field"
                  value={serviceAction}
                  onChange={(e) => {
                    const nextAction = e.target.value as WebhookServiceAction | "";
                    setServiceAction(nextAction);
                    if (nextAction === "no_action") {
                      setNotificationEnabled(true);
                    }
                    if (
                      nextAction === "database_backup" &&
                      serviceId &&
                      !initialServices.some((s) => s.id === serviceId && s.type === "databases")
                    ) {
                      setServiceId("");
                    }
                  }}
                >
                  <option value="">Select action...</option>
                  <option value="no_action">No action</option>
                  <option value="redeploy">Redeploy</option>
                  <option value="volume_backup">Volume → S3</option>
                  <option value="database_backup">Database → S3</option>
                  <option value="docker_command">Docker command</option>
                </select>
              </div>
              {Boolean(serviceAction) &&
                serviceAction !== "no_action" &&
                serviceAction !== "database_backup" && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Service</label>
                    <select
                      className="input-field"
                      value={serviceId}
                      onChange={(e) => {
                        setServiceId(e.target.value);
                        setVolumeSource("");
                      }}
                    >
                      <option value="">Select service…</option>
                      {initialServices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (id {s.id})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              {serviceAction === "database_backup" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Select database</label>
                  <select
                    className="input-field"
                    value={serviceId}
                    onChange={(e) => {
                      setServiceId(e.target.value);
                      setVolumeSource("");
                    }}
                  >
                    <option value="">Select database…</option>
                    {databaseServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (id {s.id})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Your managed <span className="text-foreground/90">Database</span> stacks — backup uses that
                    stack&apos;s compose file on the server.
                  </p>
                  {databaseServices.length === 0 && (
                    <p className="text-xs text-amber-400/90 mt-2">
                      No database services yet. Create a Database service under a project first.
                    </p>
                  )}
                </div>
              )}
              {serviceAction === "volume_backup" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Volume name</label>
                  {volQuery.isPending ? <p className="text-xs text-muted-foreground">Loading compose volumes…</p> : volumeOptions.length > 0 ? (
                    <select className="input-field" value={volumeSource} onChange={(e) => setVolumeSource(e.target.value)}>
                      <option value="">Pick from compose…</option>
                      {volumeOptions.map((v) => {
                        const volName = v.hostVolumeName ?? v.source;
                        return <option key={`${v.composeService}-${v.source}`} value={volName}>{v.source}{v.hostVolumeName ? ` → ${v.hostVolumeName}` : ""}</option>;
                      })}
                    </select>
                  ) : null}
                  <input className="input-field font-mono text-sm mt-2" placeholder="Or type volume name manually" value={volumeSource} onChange={(e) => setVolumeSource(e.target.value)} />
                  <VolumeBackupDbWarning className="mt-2" />
                </div>
              )}
              {serviceAction === "database_backup" && serviceId && (
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">Backup options</p>
                  <DatabaseBackupFormFields
                    key={serviceId ? `db-${serviceId}` : "db-none"}
                    service={
                      selectedService?.type === "databases" ? selectedService : null
                    }
                    values={dbBackup}
                    onChange={(patch) => setDbBackup((prev) => ({ ...prev, ...patch }))}
                    onReplaceValues={setDbBackup}
                  />
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Output is compressed and uploaded to S3 from a temp folder on the server (Postgres/MySQL/MariaDB:
                    SQL gzip; MongoDB: archive gzip; Redis: RDB).
                  </p>
                </div>
              )}
              {serviceAction === "docker_command" && (
                <div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Terminal className="w-3.5 h-3.5" /> Docker command
                  </label>
                  <textarea
                    className="input-field font-mono text-sm min-h-[88px] resize-y"
                    value={dockerCommand}
                    onChange={(e) => setDockerCommand(e.target.value)}
                    placeholder="docker compose ps"
                  />
                </div>
              )}
              {(serviceAction === "volume_backup" ||
                (serviceAction === "database_backup" && Boolean(serviceId))) && (
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
                      </Link>{" "}
                      — backups are stored in S3 only (short-lived temp files on the server during upload).
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      The archive is written to a temp folder during upload, then removed — only S3 retains the backup.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  Notification
                  {notificationRequired ? " — required" : " (optional)"}
                </p>
                {!notificationRequired && (
                  <button
                    type="button"
                    className="btn-secondary text-xs px-3 py-1.5"
                    onClick={() => {
                      if (notificationEnabled) {
                        setNotifyChannelId("");
                        setNotifyMessage("");
                      }
                      setNotificationEnabled((prev) => !prev);
                    }}
                  >
                    {notificationEnabled ? "Disable" : "Enable"}
                  </button>
                )}
              </div>
              {showNotificationFields && (
                <>
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
                    <textarea className="input-field min-h-[80px] resize-y" value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} placeholder="Write the exact message to send." />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/cron-jobs"><button type="button" className="btn-secondary">Cancel</button></Link>
              <button type="button" onClick={submit} disabled={createMutation.isPending} className="btn-primary flex items-center gap-2">
                {createMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : "Create cron job"}
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
