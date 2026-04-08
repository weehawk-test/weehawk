"use client";

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCreateCronJob } from "@/hooks/use-cron-jobs";
import { type WebhookTargetMode } from "@/lib/webhooks-api";
import type { Service } from "@/lib/schema";
import type { NotificationChannel } from "@/lib/notifications-api";
import type { S3ProfilePublic } from "@/lib/s3-api";
import type { RemoteServerRow } from "@/lib/remote-servers-api";
import { X, Loader2, Type, AlignLeft, ChevronsUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  initialServices: Service[];
  initialChannels: NotificationChannel[];
  initialS3Profiles: S3ProfilePublic[];
  initialRemoteServers: RemoteServerRow[];
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

function renderHighlightedScript(script: string): JSX.Element[] {
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

export function CreateCronJobClient({
  initialServices,
  initialChannels,
  initialS3Profiles,
  initialRemoteServers,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const createMutation = useCreateCronJob();
  void initialS3Profiles;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cronPreset, setCronPreset] = useState<CronPreset>("every_15_minutes");
  const [cronExpression, setCronExpression] = useState("*/15 * * * *");
  const [targetMode] = useState<WebhookTargetMode>("service");
  const deployServers = useMemo(
    () => initialRemoteServers.filter((s) => s.serverRole === "deploy"),
    [initialRemoteServers],
  );
  const [remoteServerId, setRemoteServerId] = useState("");
  const [bashScript, setBashScript] = useState("");
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [notifyChannelId, setNotifyChannelId] = useState("");
  const [notifyMessage, setNotifyMessage] = useState("");
  const showNotificationFields = notificationEnabled;
  const scriptLines = Math.max(1, bashScript.split("\n").length);
  const SCRIPT_MIN_HEIGHT = 180;
  const SCRIPT_MAX_HEIGHT = 520;
  const [scriptEditorHeight, setScriptEditorHeight] = useState(SCRIPT_MIN_HEIGHT);
  const scriptHighlightRef = useRef<HTMLPreElement | null>(null);
  const scriptLineNumbersRef = useRef<HTMLDivElement | null>(null);
  void initialServices;

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
    const hasNotifyChannel = Boolean(notifyChannelId.trim());
    const hasNotifyMessage = Boolean(notifyMessage.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      toast({ title: "Choose channel and message together", variant: "destructive" });
      return;
    }

    const parsedRemoteServerId = remoteServerId ? Number(remoteServerId) : undefined;
    if (parsedRemoteServerId != null && (!Number.isInteger(parsedRemoteServerId) || parsedRemoteServerId < 1)) {
      toast({ title: "Select a valid server", variant: "destructive" });
      return;
    }

    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        cronExpression: cronExpression.trim(),
        targetMode,
        serviceAction: "docker_command",
        dockerCommand: bashScript.trim(),
        ...(parsedRemoteServerId ? { remoteServerId: parsedRemoteServerId } : {}),
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
              <div className="space-y-3 rounded-xl border border-border bg-muted/65 dark:bg-black/30 p-4">
                <label className="text-xs text-muted-foreground mb-1 block">Cron presets</label>
                <select
                  className="input-field"
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
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Server</label>
                <select
                  className="input-field"
                  value={remoteServerId}
                  onChange={(e) => setRemoteServerId(e.target.value)}
                >
                  <option value="">Local Server</option>
                  {deployServers.map((srv) => (
                    <option key={srv.id} value={srv.id}>
                      {srv.name} ({srv.host})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Keep Local Server selected to run here, or choose a remote deploy server.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Bash script</label>
                <div className="relative overflow-hidden rounded-xl border border-border bg-black/50">
                  <div className="flex overflow-hidden" style={{ height: `${scriptEditorHeight}px` }}>
                    <div
                      ref={scriptLineNumbersRef}
                      className="h-full w-12 shrink-0 overflow-hidden border-r border-white/10 bg-black/40 px-2 py-3 font-mono text-xs text-muted-foreground text-right select-none"
                    >
                      {Array.from({ length: scriptLines }, (_, i) => (
                        <div key={`ln-${i}`} className="leading-6">
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    <div className="relative flex-1">
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
echo "Cron job done"`}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onMouseDown={handleScriptResizeStart}
                    className="h-6 w-full border-t border-white/10 bg-black/40 hover:bg-black/55 cursor-default hover:cursor-ns-resize transition-colors flex items-center justify-center"
                    aria-label="Resize script editor"
                    title="Drag to resize"
                  >
                    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 p-1 text-white/70">
                      <ChevronsUpDown className="h-3 w-3" />
                    </span>
                  </button>
                </div>
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
