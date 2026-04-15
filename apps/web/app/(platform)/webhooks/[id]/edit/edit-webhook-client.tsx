"use client";

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUpdateWebhook } from "@/hooks/use-webhooks";
import {
  hooksPublicHostForDisplay,
  webhookRouteId,
  type WebhookDetail,
  type WebhookRemoteTriggerUrlScheme,
} from "@/lib/webhooks-api";
import { hostsFromRemoteServerDomainsJson } from "@/lib/remote-server-domains-json";
import type { NotificationChannel } from "@/lib/notifications-api";
import type { RemoteServerRow } from "@/lib/remote-servers-api";
import { filterSshDeployServers } from "@/lib/loopback-ssh-host";
import type { S3ProfilePublic } from "@/lib/s3-api";
import type { Service } from "@/lib/schema";
import { AlignLeft, ChevronsUpDown, Loader2, Type, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DatabaseBackupFormFields } from "@/components/database-backup-form-fields";
import { VolumeBackupDbWarning } from "@/components/volume-backup-db-warning";
import {
  resolveBackupFormat,
  validateDatabaseBackupForm,
  type DatabaseBackupFormValues,
} from "@/lib/database-backup-preview";
import type { DatabaseBackupConfig } from "@/lib/webhooks-api";

function renderHighlightedScript(script: string) {
  const lines = (script || "").split("\n");
  return lines.map((line, index) => {
    const isComment = /^\s*#/.test(line);
    return (
      <div key={`line-${index}`}>
        <span className={isComment ? "text-emerald-400" : "text-foreground"}>{line || " "}</span>
      </div>
    );
  });
}

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
  initialWebhook: WebhookDetail;
  initialChannels: NotificationChannel[];
  initialS3Profiles: S3ProfilePublic[];
  initialServices: Service[];
  initialRemoteServers: RemoteServerRow[];
};

export function EditWebhookClient({
  initialWebhook,
  initialChannels,
  initialS3Profiles,
  initialServices,
  initialRemoteServers,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const updateMutation = useUpdateWebhook();

  const [name, setName] = useState(initialWebhook.name);
  const [description, setDescription] = useState(initialWebhook.description ?? "");
  const [bashScript, setBashScript] = useState(initialWebhook.dockerCommand ?? "");
  const scriptLines = Math.max(1, bashScript.split("\n").length);
  const SCRIPT_MIN_HEIGHT = 180;
  const SCRIPT_MAX_HEIGHT = 520;
  const [scriptEditorHeight, setScriptEditorHeight] = useState(SCRIPT_MIN_HEIGHT);
  const scriptHighlightRef = useRef<HTMLPreElement | null>(null);
  const scriptLineNumbersRef = useRef<HTMLDivElement | null>(null);
  const [notifyChannelId, setNotifyChannelId] = useState(initialWebhook.notifyChannelId ?? "");
  const [notifyMessage, setNotifyMessage] = useState(initialWebhook.notifyMessage ?? "");
  const [notificationEnabled, setNotificationEnabled] = useState(
    Boolean(initialWebhook.notifyChannelId && initialWebhook.notifyMessage),
  );
  const [remoteServerId, setRemoteServerId] = useState(
    initialWebhook.remoteServerId != null ? String(initialWebhook.remoteServerId) : "",
  );
  const [hooksPublicHost, setHooksPublicHost] = useState(
    hooksPublicHostForDisplay(initialWebhook.hooksPublicHost),
  );
  const [remoteTriggerUrlScheme, setRemoteTriggerUrlScheme] =
    useState<WebhookRemoteTriggerUrlScheme>(
      initialWebhook.remoteTriggerUrlScheme === "https" ? "https" : "http",
    );
  const [backupS3ProfileName, setBackupS3ProfileName] = useState(
    initialWebhook.backupS3ProfileName ?? "",
  );
  const [dbBackup, setDbBackup] = useState<DatabaseBackupFormValues>(() =>
    backupConfigToForm(initialWebhook.databaseBackupConfig),
  );

  const selectedService = useMemo(() => {
    const sid = initialWebhook.serviceId;
    if (sid == null) return null;
    return initialServices.find((s) => Number(s.id) === sid) ?? null;
  }, [initialServices, initialWebhook.serviceId]);
  const deployServers = useMemo(
    () => filterSshDeployServers(initialRemoteServers),
    [initialRemoteServers],
  );
  const selectedDeployServer = useMemo(
    () => deployServers.find((s) => String(s.id) === remoteServerId) ?? null,
    [deployServers, remoteServerId],
  );
  const serverHostnames = useMemo(
    () => hostsFromRemoteServerDomainsJson(selectedDeployServer?.domainsJson ?? null),
    [selectedDeployServer?.domainsJson],
  );
  const parentDomainSelectOptions = useMemo(() => {
    const list = [...serverHostnames];
    const cur = hooksPublicHost.trim();
    if (cur && !list.some((h) => h.toLowerCase() === cur.toLowerCase())) {
      list.unshift(cur);
    }
    return list;
  }, [serverHostnames, hooksPublicHost]);

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const hasNotifyChannel = notificationEnabled && Boolean(notifyChannelId.trim());
    const hasNotifyMessage = notificationEnabled && Boolean(notifyMessage.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      toast({ title: "Choose channel and message together", variant: "destructive" });
      return;
    }

    const backup =
      initialWebhook.serviceAction === "volume_backup" ||
      initialWebhook.serviceAction === "database_backup";
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
    if (initialWebhook.serviceAction === "database_backup") {
      const v = validateDatabaseBackupForm(dbBackup);
      if (!v.ok) {
        toast({ title: "Database backup", description: v.message, variant: "destructive" });
        return;
      }
    }
    let parsedRemoteServerId: number | null = null;
    if (initialWebhook.serviceAction === "docker_command") {
      if (!remoteServerId.trim()) {
        toast({
          title: "Deploy server required",
          description: "Choose a deploy remote server.",
          variant: "destructive",
        });
        return;
      }
      parsedRemoteServerId = Number(remoteServerId);
      if (!Number.isInteger(parsedRemoteServerId) || parsedRemoteServerId < 1) {
        toast({ title: "Select a valid server", variant: "destructive" });
        return;
      }
      const host = hooksPublicHost.trim();
      if (!host) {
        toast({
          title: "Hostname required",
          description:
            parentDomainSelectOptions.length === 0
              ? "Add at least one hostname for this deploy server on the Domains page."
              : "Choose a hostname from the list.",
          variant: "destructive",
        });
        return;
      }
      if (!parentDomainSelectOptions.some((h) => h.toLowerCase() === host.toLowerCase())) {
        toast({
          title: "Invalid hostname",
          description: "Pick a hostname from the list for this deploy server.",
          variant: "destructive",
        });
        return;
      }
    }

    updateMutation.mutate(
      {
        id: initialWebhook.id,
        name: name.trim(),
        description: description.trim(),
        notifyChannelId: hasNotifyChannel ? notifyChannelId : null,
        notifyMessage: hasNotifyMessage ? notifyMessage.trim() : null,
        ...(backup
          ? {
              backupS3ProfileName: backupS3ProfileName.trim() || null,
            }
          : {}),
        ...(initialWebhook.serviceAction === "database_backup"
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
        ...(initialWebhook.serviceAction === "docker_command"
          ? {
              dockerCommand: bashScript.trim() || null,
              remoteServerId: parsedRemoteServerId,
              hooksPublicHost: hooksPublicHost.trim(),
              remoteTriggerUrlScheme,
            }
          : {}),
      },
      {
        onSuccess: (updated) => router.push(`/webhooks/${webhookRouteId(updated)}`),
        onError: (e: Error) =>
          toast({ title: "Could not update webhook", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleScriptResizeStart = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = scriptEditorHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextHeight = Math.min(SCRIPT_MAX_HEIGHT, Math.max(SCRIPT_MIN_HEIGHT, startHeight + delta));
      setScriptEditorHeight(nextHeight);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  if (typeof document === "undefined") return null;

  const closeModal = () => {
    if (updateMutation.isPending) return;
    router.push("/webhooks");
  };

  return createPortal(
      <div
        className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-start justify-center px-4 py-6 md:px-6 md:py-8"
        onClick={closeModal}
      >
        <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="glass-panel p-6 md:p-8 rounded-2xl relative overflow-hidden">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-foreground">Edit webhook</h1>
            <Link href="/webhooks" aria-label="Close">
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
              <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
                <AlignLeft className="w-4 h-4 text-primary" /> Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea className="input-field min-h-[72px] resize-none" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            {initialWebhook.serviceAction === "docker_command" && (
              <div className="space-y-4 rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4">
                <label className="text-xs text-muted-foreground mb-1 block">Deploy server</label>
                <select
                  className="input-field mb-3"
                  value={remoteServerId}
                  onChange={(e) => {
                    setRemoteServerId(e.target.value);
                    setHooksPublicHost("");
                  }}
                  required
                  disabled={deployServers.length === 0}
                >
                  <option value="" disabled>
                    {deployServers.length === 0
                      ? "No deploy servers — add one under Remote servers"
                      : "Select a deploy server…"}
                  </option>
                  {deployServers.map((srv) => (
                    <option key={srv.id} value={String(srv.id)}>
                      {srv.name} ({srv.host})
                    </option>
                  ))}
                </select>
                <label className="text-xs text-muted-foreground mb-1 block mt-3">Hostname</label>
                <select
                  className="input-field mb-3"
                  value={hooksPublicHost}
                  onChange={(e) => setHooksPublicHost(e.target.value)}
                  required
                  disabled={!remoteServerId || parentDomainSelectOptions.length === 0}
                >
                  <option value="" disabled>
                    {!remoteServerId
                      ? "Select a deploy server first"
                      : parentDomainSelectOptions.length === 0
                        ? "No hostnames — add them on the Domains page"
                        : "Select a hostname…"}
                  </option>
                  {parentDomainSelectOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                {!remoteServerId ? (
                  <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
                    Set this webhook&apos;s deploy server above, then add hostnames on{" "}
                    <Link href="/domains" className="text-primary hover:underline">
                      Domains
                    </Link>
                    .
                  </p>
                ) : parentDomainSelectOptions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
                    Add hostnames on{" "}
                    <Link href="/domains" className="text-primary hover:underline">
                      Domains
                    </Link>{" "}
                    first.
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 mb-3">
                  <div className="space-y-0.5 min-w-0">
                    <Label
                      htmlFor="webhook-trigger-https"
                      className="text-sm font-medium text-foreground cursor-pointer"
                    >
                      HTTPS
                    </Label>
                  </div>
                  <Switch
                    id="webhook-trigger-https"
                    checked={remoteTriggerUrlScheme === "https"}
                    onCheckedChange={(v) =>
                      setRemoteTriggerUrlScheme(v ? "https" : "http")
                    }
                    className="shrink-0"
                  />
                </div>
                <label className="text-xs text-muted-foreground mb-1 block">Bash script</label>
                <div className="relative overflow-hidden rounded-xl border border-border bg-black/50 dark:bg-black">
                  <div className="flex overflow-hidden" style={{ height: `${scriptEditorHeight}px` }}>
                    <div
                      ref={scriptLineNumbersRef}
                      className="h-full w-12 shrink-0 overflow-hidden border-r border-white/10 bg-black/40 dark:bg-black px-2 py-3 font-mono text-xs text-muted-foreground text-right select-none"
                    >
                      {Array.from({ length: scriptLines }, (_, i) => (
                        <div key={`ln-${i}`} className="leading-6">
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    <div className="relative flex-1 dark:bg-black">
                      <pre
                        ref={scriptHighlightRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 overflow-auto p-3 font-mono text-sm leading-6 whitespace-pre-wrap break-words"
                      >
                        {renderHighlightedScript(bashScript)}
                      </pre>
                      <textarea
                        className="relative z-10 h-full w-full resize-none bg-transparent p-3 font-mono text-sm leading-6 text-transparent caret-white placeholder:text-slate-400/80 selection:text-white selection:bg-primary/45 focus:outline-none"
                        value={bashScript}
                        onChange={(e) => setBashScript(e.target.value)}
                        onScroll={(e) => {
                          const top = e.currentTarget.scrollTop;
                          const left = e.currentTarget.scrollLeft;
                          if (scriptHighlightRef.current) {
                            scriptHighlightRef.current.scrollTop = top;
                            scriptHighlightRef.current.scrollLeft = left;
                          }
                          if (scriptLineNumbersRef.current) {
                            scriptLineNumbersRef.current.scrollTop = top;
                          }
                        }}
                        spellCheck={false}
                        placeholder={`#!/usr/bin/env bash
echo "Webhook done"`}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onMouseDown={handleScriptResizeStart}
                    className="h-6 w-full border-t border-white/10 bg-black/40 dark:bg-black hover:bg-black/55 dark:hover:bg-black cursor-default hover:cursor-ns-resize transition-colors flex items-center justify-center"
                    aria-label="Resize script editor"
                    title="Drag to resize"
                  >
                    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 p-1 text-white/70">
                      <ChevronsUpDown className="h-3 w-3" />
                    </span>
                  </button>
                </div>
              </div>
            )}
            {initialWebhook.serviceAction === "database_backup" && (
              <div className="rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4 space-y-3">
                <p className="text-sm font-medium">Backup options</p>
                {!initialWebhook.databaseBackupConfig && (
                  <p className="text-xs text-amber-400/90">
                    This webhook used a legacy Docker command. Set engine and service below so backups use the
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
            {(initialWebhook.serviceAction === "volume_backup" ||
              initialWebhook.serviceAction === "database_backup") && (
              <div className="rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4 space-y-3">
                {initialWebhook.serviceAction === "volume_backup" && (
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

            <div className="rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Notification (optional)</p>
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
              </div>
              {notificationEnabled && (
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
                    <textarea className="input-field min-h-[80px] resize-y" value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Link href="/webhooks"><button type="button" className="btn-secondary">Cancel</button></Link>
              <button type="button" onClick={submit} disabled={updateMutation.isPending} className="btn-primary flex items-center gap-2">
                {updateMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
