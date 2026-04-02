"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCreateWebhook } from "@/hooks/use-webhooks";
import { type WebhookServiceAction, type WebhookTargetMode } from "@/lib/webhooks-api";
import type { Service } from "@/lib/schema";
import type { NotificationChannel } from "@/lib/notifications-api";
import { X, Loader2, Terminal, Type, AlignLeft } from "lucide-react";
import { useServiceVolumes } from "@/hooks/use-services";
import { useToast } from "@/hooks/use-toast";

type Props = {
  initialServices: Service[];
  initialChannels: NotificationChannel[];
};

export function CreateWebhookClient({ initialServices, initialChannels }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const createMutation = useCreateWebhook();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetMode] = useState<WebhookTargetMode>("service");
  const [serviceId, setServiceId] = useState("");
  const [serviceAction, setServiceAction] = useState<WebhookServiceAction | "">("");
  const [volumeSource, setVolumeSource] = useState("");
  const [dockerCommand, setDockerCommand] = useState("docker ");
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

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!serviceAction) {
      toast({ title: "Select an action", variant: "destructive" });
      return;
    }
    if (serviceAction !== "no_action" && !serviceId) {
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
        targetMode,
        ...(serviceAction !== "no_action" ? { serviceId: parsedServiceId } : {}),
        serviceAction: serviceAction as WebhookServiceAction,
        ...(serviceAction === "volume_backup" ? { volumeSource: volumeSource.trim() } : {}),
        ...(serviceAction === "docker_command" ? { dockerCommand: dockerCommand.trim() } : {}),
        ...(hasNotifyChannel && hasNotifyMessage
          ? { notifyChannelId, notifyMessage: notifyMessage.trim() }
          : {}),
      },
      {
        onSuccess: (w) => router.push(`/webhooks/${w.id}`),
        onError: (e: Error) =>
          toast({ title: "Could not create webhook", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <>
      <div className="max-w-2xl mx-auto">
        <div className="glass-panel p-6 md:p-8 rounded-2xl relative overflow-hidden">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-foreground">Create webhook</h1>
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
                <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub → redeploy API" />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
                  <AlignLeft className="w-4 h-4 text-primary" /> Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea className="input-field min-h-[72px] resize-none" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What triggers this?" />
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4">
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
                  }}
                >
                  <option value="">Select action...</option>
                  <option value="no_action">No action (just notification)</option>
                  <option value="redeploy">Redeploy (compose up / rolling restart)</option>
                  <option value="volume_backup">Volume backup (tar.gz on server)</option>
                  <option value="docker_command">Custom docker command</option>
                </select>
              </div>
              {Boolean(serviceAction) && serviceAction !== "no_action" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Service</label>
                  <select className="input-field" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setVolumeSource(""); }}>
                    <option value="">Select service…</option>
                    {initialServices.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} (id {s.id})</option>
                    ))}
                  </select>
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
                </div>
              )}
              {serviceAction === "docker_command" && (
                <div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Terminal className="w-3.5 h-3.5" /> Docker command
                  </label>
                  <textarea className="input-field font-mono text-sm min-h-[88px] resize-y" value={dockerCommand} onChange={(e) => setDockerCommand(e.target.value)} placeholder="docker compose ps" />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  Optional notification
                  {notificationRequired ? " (required for no action)" : ""}
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
              <Link href="/webhooks"><button type="button" className="btn-secondary">Cancel</button></Link>
              <button type="button" onClick={submit} disabled={createMutation.isPending} className="btn-primary flex items-center gap-2">
                {createMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : "Create webhook"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
