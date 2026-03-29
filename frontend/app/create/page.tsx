"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCreateWebhook } from "@/hooks/use-webhooks";
import { useAuth } from "@/contexts/auth-context";
import { fetchServices } from "@/lib/services-api";
import { fetchNotificationChannels } from "@/lib/notifications-api";
import {
  publicWebhookTriggerUrl,
  type WebhookServiceAction,
  type WebhookTargetMode,
} from "@/lib/webhooks-api";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  ArrowLeft,
  Bell,
  Loader2,
  Server,
  Terminal,
  Type,
  AlignLeft,
} from "lucide-react";
import { useServiceVolumes } from "@/hooks/use-services";
import { useToast } from "@/hooks/use-toast";

export default function CreateWebhook() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const createMutation = useCreateWebhook();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetMode, setTargetMode] = useState<WebhookTargetMode>("service");
  const [serviceId, setServiceId] = useState("");
  const [serviceAction, setServiceAction] = useState<WebhookServiceAction>("redeploy");
  const [volumeSource, setVolumeSource] = useState("");
  const [dockerCommand, setDockerCommand] = useState("docker ");
  const [notifyOnTrigger, setNotifyOnTrigger] = useState(false);
  const [notifyChannelId, setNotifyChannelId] = useState("");

  const servicesQuery = useQuery({
    queryKey: ["services", "all"],
    queryFn: () => fetchServices(),
    staleTime: 15_000,
  });

  const channelsQuery = useQuery({
    queryKey: ["notifications", "channels", "create-webhook"],
    queryFn: () => fetchNotificationChannels(accessToken!),
    enabled: Boolean(accessToken),
  });

  const volQuery = useServiceVolumes(
    serviceId || undefined,
    targetMode === "service" && serviceAction === "volume_backup" && Boolean(serviceId),
  );

  const volumeOptions = useMemo(() => {
    const items = volQuery.data?.items ?? [];
    return items.filter((v) => v.mountType === "volume" && v.source && v.source !== "—");
  }, [volQuery.data]);

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (targetMode === "service") {
      if (!serviceId) {
        toast({ title: "Select a service", variant: "destructive" });
        return;
      }
      if (serviceAction === "volume_backup" && !volumeSource.trim()) {
        toast({ title: "Select or enter a volume name", variant: "destructive" });
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
    }
    if (notifyOnTrigger && !notifyChannelId) {
      toast({ title: "Select a notification channel", variant: "destructive" });
      return;
    }

    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        targetMode,
        ...(targetMode === "service"
          ? {
              serviceId: Number(serviceId),
              serviceAction,
              ...(serviceAction === "volume_backup"
                ? { volumeSource: volumeSource.trim() }
                : {}),
              ...(serviceAction === "docker_command"
                ? { dockerCommand: dockerCommand.trim() }
                : {}),
            }
          : {}),
        notifyOnTrigger,
        ...(notifyOnTrigger && notifyChannelId ? { notifyChannelId } : {}),
      },
      {
        onSuccess: (w) => {
          router.push(`/webhooks/${w.id}`);
        },
        onError: (e: Error) => {
          toast({ title: "Could not create webhook", description: e.message, variant: "destructive" });
        },
      },
    );
  };

  const previewToken = "…your-secret…";
  const previewUrl = publicWebhookTriggerUrl(previewToken);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <Link href="/webhooks">
          <button
            type="button"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back to webhooks
          </button>
        </Link>

        <div className="glass-panel p-6 md:p-8 rounded-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-56 h-56 bg-primary/10 blur-[72px] pointer-events-none" />

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-foreground mb-2">Create webhook</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Secret URL: redeploy, volume backup, <span className="text-foreground font-medium">docker</span> command, optional Telegram.
            </p>
          </div>

          <div className="space-y-6 relative z-10">
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
                  <Type className="w-4 h-4 text-primary" /> Name
                </label>
                <input
                  className="input-field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. GitHub → redeploy API"
                />
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
                  placeholder="What triggers this?"
                />
              </div>
            </div>

            <hr className="border-border" />

            <div>
              <p className="text-sm font-medium text-foreground mb-3">When the URL is hit</p>
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-white/10 p-4 hover:bg-white/[0.02]">
                  <input
                    type="radio"
                    name="tm"
                    checked={targetMode === "service"}
                    onChange={() => setTargetMode("service")}
                    className="mt-1"
                  />
                  <div>
                    <div className="flex items-center gap-2 text-base font-medium">
                      <Server className="w-4 h-4 text-primary shrink-0" /> Service (Docker)
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Redeploy, volume backup, or docker command in deploy dir.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-white/10 p-4 hover:bg-white/[0.02]">
                  <input
                    type="radio"
                    name="tm"
                    checked={targetMode === "notify_only"}
                    onChange={() => setTargetMode("notify_only")}
                    className="mt-1"
                  />
                  <div>
                    <div className="flex items-center gap-2 text-base font-medium">
                      <Bell className="w-4 h-4 text-primary shrink-0" /> Notification only
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      No Docker — Telegram only if enabled below.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {targetMode === "service" && (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Service</label>
                  <select
                    className="input-field"
                    value={serviceId}
                    onChange={(e) => {
                      setServiceId(e.target.value);
                      setVolumeSource("");
                    }}
                    disabled={servicesQuery.isPending}
                  >
                    <option value="">Select service…</option>
                    {(servicesQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (id {s.id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Action</label>
                  <select
                    className="input-field"
                    value={serviceAction}
                    onChange={(e) => setServiceAction(e.target.value as WebhookServiceAction)}
                  >
                    <option value="redeploy">Redeploy (compose up / rolling restart)</option>
                    <option value="volume_backup">Volume backup (tar.gz on server)</option>
                    <option value="docker_command">Custom docker command</option>
                  </select>
                </div>
                {serviceAction === "volume_backup" && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Volume name</label>
                    {volQuery.isPending ? (
                      <p className="text-xs text-muted-foreground">Loading compose volumes…</p>
                    ) : volumeOptions.length > 0 ? (
                      <select
                        className="input-field"
                        value={volumeSource}
                        onChange={(e) => setVolumeSource(e.target.value)}
                      >
                        <option value="">Pick from compose…</option>
                        {volumeOptions.map((v) => {
                          const volName = v.hostVolumeName ?? v.source;
                          return (
                            <option key={`${v.composeService}-${v.source}`} value={volName}>
                              {v.source}
                              {v.hostVolumeName ? ` → ${v.hostVolumeName}` : ""}
                            </option>
                          );
                        })}
                      </select>
                    ) : null}
                    <input
                      className="input-field font-mono text-sm mt-2"
                      placeholder="Or type volume name manually"
                      value={volumeSource}
                      onChange={(e) => setVolumeSource(e.target.value)}
                    />
                  </div>
                )}
                {serviceAction === "docker_command" && (
                  <div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <Terminal className="w-3.5 h-3.5" /> Docker command
                    </label>
                    <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                      <span className="text-primary font-medium">docker</span> CLI; prefix added if missing. No{" "}
                      <code className="text-foreground">;|&amp;</code> or subshells.
                    </p>
                    <textarea
                      className="input-field font-mono text-sm min-h-[88px] resize-y"
                      value={dockerCommand}
                      onChange={(e) => setDockerCommand(e.target.value)}
                      placeholder="docker compose ps"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-white/10 p-4 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyOnTrigger}
                  onChange={(e) => setNotifyOnTrigger(e.target.checked)}
                />
                <span className="text-sm font-medium">Send Telegram when triggered</span>
              </label>
              {notifyOnTrigger && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Notification channel</label>
                  <select
                    className="input-field"
                    value={notifyChannelId}
                    onChange={(e) => setNotifyChannelId(e.target.value)}
                    disabled={channelsQuery.isPending}
                  >
                    <option value="">Select channel…</option>
                    {(channelsQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-2">
                    Configure under{" "}
                    <Link href="/notifications" className="text-primary hover:underline">Notifications</Link>.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-black/50 border border-white/5 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Endpoint shape
              </h4>
              <code className="text-xs font-mono text-primary break-all block">{previewUrl}</code>
              <p className="text-xs text-muted-foreground mt-2">Use GET or POST after you create the webhook.</p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/webhooks">
                <button type="button" className="btn-secondary">
                  Cancel
                </button>
              </Link>
              <button
                type="button"
                onClick={submit}
                disabled={createMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create webhook"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
