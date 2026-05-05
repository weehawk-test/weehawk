"use client";

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUpdateCronJob } from "@/hooks/use-cron-jobs";
import { type CronJobDetail } from "@/lib/cron-jobs-api";
import type { NotificationChannel } from "@/lib/notifications-api";
import type { RemoteServerRow } from "@/lib/remote-servers-api";
import { filterSshDeployServers } from "@/lib/loopback-ssh-host";
import { AlignLeft, ChevronsUpDown, Loader2, Type, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { workspaceRoute } from "@/lib/workspace-paths";

type Props = {
  initialCronJob: CronJobDetail;
  initialChannels: NotificationChannel[];
  initialRemoteServers: RemoteServerRow[];
  organizationPublicId?: string | null;
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

function renderHighlightedScript(script: string): ReactNode[] {
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

function cronPresetFromExpression(expr: string): CronPreset {
  const v = (expr || "").trim();
  if (v === "* * * * *") return "every_minute";
  if (v === "0 * * * *") return "every_hour";
  if (v === "0 0 * * *") return "every_day_midnight";
  if (v === "0 0 * * 0") return "every_sunday_midnight";
  if (v === "0 0 1 * *") return "every_month_1_midnight";
  if (v === "*/15 * * * *") return "every_15_minutes";
  if (v === "0 0 * * 1-5") return "every_weekday_midnight";
  return "custom";
}

export function EditCronJobClient({
  initialCronJob,
  initialChannels,
  initialRemoteServers,
  organizationPublicId = null,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const updateMutation = useUpdateCronJob(organizationPublicId);
  const cronJobsHref = useMemo(
    () => workspaceRoute(organizationPublicId, "/cron-jobs"),
    [organizationPublicId],
  );

  const [name, setName] = useState(initialCronJob.name);
  const [description, setDescription] = useState(initialCronJob.description ?? "");
  const [cronPreset, setCronPreset] = useState<CronPreset>(
    cronPresetFromExpression(initialCronJob.cronExpression ?? ""),
  );
  const [cronExpression, setCronExpression] = useState(initialCronJob.cronExpression ?? "");
  const [bashScript, setBashScript] = useState(initialCronJob.bashScript ?? "");
  const scriptLines = Math.max(1, bashScript.split("\n").length);
  const SCRIPT_MIN_HEIGHT = 180;
  const SCRIPT_MAX_HEIGHT = 520;
  const [scriptEditorHeight, setScriptEditorHeight] = useState(SCRIPT_MIN_HEIGHT);
  const scriptHighlightRef = useRef<HTMLPreElement | null>(null);
  const scriptLineNumbersRef = useRef<HTMLDivElement | null>(null);
  const [notifyChannelId, setNotifyChannelId] = useState(
    initialCronJob.notifyChannelId != null ? String(initialCronJob.notifyChannelId) : "",
  );
  const [notifyMessage, setNotifyMessage] = useState(initialCronJob.notifyMessage ?? "");
  const [notificationEnabled, setNotificationEnabled] = useState(
    Boolean(initialCronJob.notifyChannelId && initialCronJob.notifyMessage),
  );
  const [remoteServerId, setRemoteServerId] = useState(
    initialCronJob.remoteServerId != null ? String(initialCronJob.remoteServerId) : "",
  );

  const deployServers = useMemo(
    () => filterSshDeployServers(initialRemoteServers),
    [initialRemoteServers],
  );

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!cronExpression.trim()) {
      toast({ title: "Cron expression required", variant: "destructive" });
      return;
    }
    if (!bashScript.trim()) {
      toast({ title: "Bash script required", variant: "destructive" });
      return;
    }
    const hasNotifyChannel = notificationEnabled && Boolean(notifyChannelId.trim());
    const hasNotifyMessage = notificationEnabled && Boolean(notifyMessage.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      toast({ title: "Choose channel and message together", variant: "destructive" });
      return;
    }
    const parsedRemoteServerId = Number(remoteServerId);
    if (!Number.isInteger(parsedRemoteServerId) || parsedRemoteServerId < 1) {
      toast({ title: "Select a deploy server", variant: "destructive" });
      return;
    }

    updateMutation.mutate(
      {
        id: initialCronJob.id,
        name: name.trim(),
        description: description.trim(),
        cronExpression: cronExpression.trim(),
        bashScript: bashScript.trim(),
        remoteServerId: parsedRemoteServerId,
        notifyChannelId: hasNotifyChannel ? Number(notifyChannelId) : null,
        notifyMessage: hasNotifyMessage ? notifyMessage.trim() : null,
      },
      {
        onSuccess: (updated) =>
          router.push(`${cronJobsHref}?provisioning=${encodeURIComponent(String(updated.id))}`),
        onError: (e: Error) =>
          toast({ title: "Could not update cron job", description: e.message, variant: "destructive" }),
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
    router.push(cronJobsHref);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-start justify-center px-4 py-6 md:px-6 md:py-8"
      onClick={closeModal}
    >
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-panel p-6 md:p-8 rounded-2xl relative overflow-hidden">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-foreground">Edit cron job</h1>
            <Link href={cronJobsHref} aria-label="Close">
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
                  <AlignLeft className="w-4 h-4 text-primary" /> Description{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  className="input-field min-h-[72px] resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4">
              <label className="text-xs text-muted-foreground mb-1 block">Cron presets</label>
              <select
                className="input-field"
                value={cronPreset}
                onChange={(e) => {
                  const nextPreset = e.target.value as CronPreset;
                  setCronPreset(nextPreset);
                  if (nextPreset === "custom") return;
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

            <div className="space-y-4 rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4">
              <label className="text-xs text-muted-foreground mb-1 block">Deploy server</label>
              <select
                className="input-field mb-3"
                value={remoteServerId}
                onChange={(e) => setRemoteServerId(e.target.value)}
                disabled={deployServers.length === 0}
              >
                <option value="" disabled>
                  {deployServers.length === 0
                    ? "No deploy servers — add one under Remote servers"
                    : "Select a deploy server…"}
                </option>
                {deployServers.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.name} ({srv.host})
                  </option>
                ))}
              </select>
              <label className="text-xs text-muted-foreground mb-1 block">Bash script</label>
              <div className="relative overflow-hidden rounded-xl border border-border bg-slate-100 dark:bg-black">
                <div className="flex overflow-hidden" style={{ height: `${scriptEditorHeight}px` }}>
                  <div
                    ref={scriptLineNumbersRef}
                    className="h-full w-12 shrink-0 overflow-hidden border-r border-slate-300 dark:border-white/10 bg-slate-200 dark:bg-black px-2 py-3 font-mono text-xs text-muted-foreground text-right select-none"
                  >
                    {Array.from({ length: scriptLines }, (_, i) => (
                      <div key={`ln-${i}`} className="leading-6">
                        {i + 1}
                      </div>
                    ))}
                  </div>
                  <div className="relative flex-1 bg-slate-100 dark:bg-black">
                    <pre
                      ref={scriptHighlightRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 overflow-auto p-3 font-mono text-sm leading-6 whitespace-pre-wrap break-words"
                    >
                      {renderHighlightedScript(bashScript)}
                    </pre>
                    <textarea
                      className="relative z-10 h-full w-full resize-none bg-transparent p-3 font-mono text-sm leading-6 text-transparent caret-slate-900 dark:caret-white placeholder:text-slate-500/90 dark:placeholder:text-slate-400/80 selection:text-white selection:bg-primary/45 focus:outline-none"
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
echo "Cron job done"`}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onMouseDown={handleScriptResizeStart}
                  className="h-6 w-full border-t border-slate-300 dark:border-white/10 bg-slate-200 dark:bg-black hover:bg-slate-300 dark:hover:bg-black cursor-default hover:cursor-ns-resize transition-colors flex items-center justify-center"
                  aria-label="Resize script editor"
                  title="Drag to resize"
                >
                  <span className="inline-flex items-center rounded-full border border-slate-400/50 bg-white/70 text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-white/70 p-1">
                    <ChevronsUpDown className="h-3 w-3" />
                  </span>
                </button>
              </div>
            </div>

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
                    <select
                      className="input-field"
                      value={notifyChannelId}
                      onChange={(e) => setNotifyChannelId(e.target.value)}
                    >
                      <option value="">No notification</option>
                      {initialChannels.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Message content</label>
                    <textarea
                      className="input-field min-h-[80px] resize-y"
                      value={notifyMessage}
                      onChange={(e) => setNotifyMessage(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Link href={cronJobsHref}>
                <button type="button" className="btn-secondary">
                  Cancel
                </button>
              </Link>
              <button
                type="button"
                onClick={submit}
                disabled={updateMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
