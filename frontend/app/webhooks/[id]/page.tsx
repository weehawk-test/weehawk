"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useWebhook, useUpdateWebhook, useDeleteWebhook } from "@/hooks/use-webhooks";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  ArrowLeft,
  Copy,
  CheckCircle2,
  Terminal,
  Activity,
  Clock,
  Hash,
  Link as LinkIcon,
  Trash2,
  ShieldAlert,
  Bell,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { motion } from "framer-motion";
import { publicWebhookTriggerUrl } from "@/lib/webhooks-api";

export default function WebhookDetails() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();

  const { data: webhook, isLoading, error, isFetching } = useWebhook(id);
  const updateMutation = useUpdateWebhook();
  const deleteMutation = useDeleteWebhook();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [copied, setCopied] = useState(false);

  const webhookUrl = webhook ? publicWebhookTriggerUrl(webhook.secretToken) : "";

  const handleCopy = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast({
        title: "Copied",
        description: "Webhook URL copied to clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Copy the URL manually.",
        variant: "destructive",
      });
    }
  };

  const handleToggleActive = () => {
    if (!webhook) return;
    updateMutation.mutate(
      { id, isActive: !webhook.isActive },
      {
        onSuccess: (updated) => {
          toast({
            title: updated.isActive ? "Activated" : "Deactivated",
            description: updated.isActive
              ? "This URL will run actions again."
              : "Requests will receive 404.",
          });
        },
        onError: (e: Error) =>
          toast({ title: "Update failed", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (isLoading && !webhook) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[50vh]">
          <div className="w-9 h-9 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (error || !webhook) {
    return (
      <AppLayout>
        <div className="text-center mt-20">
          <ShieldAlert className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Webhook not found</h2>
          <p className="text-muted-foreground mb-6">
            It may have been deleted or you may not have access.
          </p>
          <Link href="/webhooks">
            <button type="button" className="btn-primary">
              Back to webhooks
            </button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <Link href="/webhooks">
          <button
            type="button"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back to webhooks
          </button>
        </Link>

        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{webhook.name}</h1>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                  webhook.isActive
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-muted text-muted-foreground border border-white/5"
                }`}
              >
                {webhook.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            {webhook.description && (
              <p className="text-muted-foreground text-base">{webhook.description}</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleToggleActive}
            disabled={updateMutation.isPending || isFetching}
            className="btn-secondary whitespace-nowrap"
          >
            {webhook.isActive ? "Deactivate" : "Activate"}
          </button>
        </div>

        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="glass-panel p-1 rounded-2xl mb-6 relative group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />
          <div className="bg-background rounded-xl p-5 relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex-1 overflow-hidden min-w-0">
              <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                <LinkIcon className="w-3.5 h-3.5" /> Trigger URL (GET or POST)
              </label>
              <div className="font-mono text-primary text-sm break-all selection:bg-primary/30 leading-relaxed">
                {webhookUrl}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 text-foreground rounded-lg transition-all shrink-0 font-medium"
            >
              {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="glass-panel p-5 rounded-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Terminal className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-base">Target</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Mode</p>
                <p className="font-medium text-foreground">
                  {webhook.targetMode === "notify_only" ? "Notification only" : "Service (Docker)"}
                </p>
              </div>
              {webhook.targetMode === "service" && (
                <>
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Service ID</p>
                    <p className="font-mono text-foreground">{webhook.serviceId ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Action</p>
                    <p className="font-medium text-foreground">{webhook.serviceAction ?? "—"}</p>
                  </div>
                  {webhook.volumeSource && (
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">Volume</p>
                      <p className="font-mono text-xs break-all">{webhook.volumeSource}</p>
                    </div>
                  )}
                  {webhook.dockerCommand && (
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">Docker command</p>
                      <pre className="bg-black/40 px-3 py-2 rounded-lg border border-white/5 font-mono text-xs whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                        {webhook.dockerCommand}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="glass-panel p-5 rounded-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-base">Notifications</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Telegram on trigger</p>
                <p className="font-medium text-foreground">{webhook.notifyOnTrigger ? "Enabled" : "Off"}</p>
              </div>
              {webhook.notifyChannelId && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Channel ID</p>
                  <p className="font-mono text-xs break-all">{webhook.notifyChannelId}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-white/5">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-base">Meta</h3>
            </div>
            <div className="space-y-3 text-sm mt-4">
              <div>
                <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" /> ID
                </p>
                <p className="font-mono text-xs break-all">{webhook.id}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Created
                </p>
                <p className="font-medium text-foreground text-sm">
                  {format(new Date(webhook.createdAt), "MMMM d, yyyy 'at' h:mm a")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 p-5 border border-destructive/20 bg-destructive/5 rounded-2xl">
          <h3 className="font-bold text-destructive text-base mb-1.5">Danger zone</h3>
          <p className="text-sm text-muted-foreground mb-5">
            Deleting invalidates the secret URL immediately.
          </p>
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: "Delete this webhook?",
                description: "The URL will stop working for all callers.",
                confirmLabel: "Delete",
                variant: "destructive",
              });
              if (!ok) return;
              deleteMutation.mutate(id, {
                onSuccess: () => router.replace("/webhooks"),
                onError: (e: Error) =>
                  toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
              });
            }}
            disabled={deleteMutation.isPending}
            className="px-4 py-2.5 bg-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Delete webhook
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
