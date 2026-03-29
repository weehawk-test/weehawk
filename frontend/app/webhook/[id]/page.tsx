"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useWebhook, useUpdateWebhook, useDeleteWebhook } from "@/hooks/use-webhooks";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  ArrowLeft, Copy, CheckCircle2, Terminal, 
  Activity, Clock, Hash, Link as LinkIcon, Trash2, ShieldAlert
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { motion } from "framer-motion";

export default function WebhookDetails() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  
  const { data: webhook, isLoading, error } = useWebhook(id);
  const updateMutation = useUpdateWebhook();
  const deleteMutation = useDeleteWebhook();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [copied, setCopied] = useState(false);

  // Use window.location.origin in a real app, but we use a mock domain for the demo
  const webhookUrl = `https://api.nexus.dev/hooks/${id}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast({
        title: "Copied to clipboard!",
        description: "Webhook URL is ready to be pasted.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please copy the URL manually.",
        variant: "destructive"
      });
    }
  };

  const handleToggleActive = () => {
    if (!webhook) return;
    updateMutation.mutate({ id, isActive: !webhook.isActive }, {
      onSuccess: (updated) => {
        toast({
          title: updated.isActive ? "Webhook Activated" : "Webhook Deactivated",
          description: updated.isActive ? "The endpoint is now accepting requests." : "The endpoint will block incoming requests.",
        });
      }
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (error || !webhook) {
    return (
      <AppLayout>
        <div className="text-center mt-20">
          <ShieldAlert className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Webhook Not Found</h2>
          <p className="text-muted-foreground mb-6">
            The webhook you&apos;re looking for doesn&apos;t exist or was deleted.
          </p>
          <Link href="/webhooks">
            <button className="btn-primary">Return to webhooks</button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <Link href="/webhooks">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to webhooks
          </button>
        </Link>

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-foreground">{webhook.name}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                webhook.isActive ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-muted text-muted-foreground border border-white/5"
              }`}>
                {webhook.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            {webhook.description && (
              <p className="text-muted-foreground text-lg">{webhook.description}</p>
            )}
          </div>

          <div className="flex gap-3">
            <button 
              onClick={handleToggleActive}
              disabled={updateMutation.isPending}
              className="btn-secondary whitespace-nowrap"
            >
              {webhook.isActive ? "Deactivate" : "Activate"}
            </button>
          </div>
        </div>

        {/* URL Card - The most important element */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="glass-panel p-1 rounded-2xl mb-8 relative group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />
          <div className="bg-background rounded-xl p-6 relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex-1 overflow-hidden">
              <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                <LinkIcon className="w-3 h-3" /> Endpoint URL
              </label>
              <div className="font-mono text-primary text-sm md:text-base truncate break-all selection:bg-primary/30">
                {webhookUrl}
              </div>
            </div>
            <button 
              onClick={handleCopy}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 text-foreground rounded-lg transition-all shrink-0 font-medium"
            >
              {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              {copied ? "Copied!" : "Copy URL"}
            </button>
          </div>
        </motion.div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-panel p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Terminal className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">Execution Details</h3>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Target Script</p>
                <div className="bg-black/40 px-4 py-3 rounded-lg border border-white/5 font-mono text-sm text-foreground">
                  $ ./scripts/<span className="text-primary">{webhook.script}</span>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Expected Method</p>
                <p className="font-medium">POST</p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">System Info</h3>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1 flex items-center gap-2">
                  <Hash className="w-4 h-4" /> UUID
                </p>
                <p className="font-mono text-sm text-foreground">{webhook.id}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Created At
                </p>
                <p className="font-medium text-foreground">
                  {format(new Date(webhook.createdAt), "MMMM do, yyyy 'at' h:mm a")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="mt-12 p-6 border border-destructive/20 bg-destructive/5 rounded-2xl">
          <h3 className="font-bold text-destructive mb-2">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Deleting this webhook will immediately invalidate the URL. Any future requests to this endpoint will fail.
          </p>
          <button 
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: "Delete this webhook?",
                description: "This will invalidate the URL. Any integrations using it will fail immediately.",
                confirmLabel: "Delete webhook",
                variant: "destructive",
              });
              if (!ok) return;
              deleteMutation.mutate(id, {
                onSuccess: () => {
                  window.location.href = "/";
                },
              });
            }}
            disabled={deleteMutation.isPending}
            className="px-4 py-2 bg-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Delete Webhook
          </button>
        </div>

      </div>
    </AppLayout>
  );
}
