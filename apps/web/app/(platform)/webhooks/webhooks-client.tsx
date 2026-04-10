"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Webhook, Plus, Search, Trash2, ChevronRight, Clock, Pencil, Loader2, Copy, Check, Power } from "lucide-react";
import { useDeleteWebhook, useUpdateWebhook } from "@/hooks/use-webhooks";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import type { WebhookListItem } from "@/lib/webhooks-api";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";

function formatDateUTC(dateInput: string): string {
  const date = new Date(dateInput);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function WebhooksClient({ initialWebhooks }: { initialWebhooks: WebhookListItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const webhooks = initialWebhooks;
  const deleteWebhook = useDeleteWebhook();
  const updateWebhook = useUpdateWebhook();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);

  const filtered =
    (webhooks ?? []).filter(
      (w) =>
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        (w.description || "").toLowerCase().includes(search.toLowerCase()) ||
        w.summary.toLowerCase().includes(search.toLowerCase()),
    );
  const webhookKeys = useMemo(() => filtered.map((w) => w.id), [filtered]);
  const webhooksBulk = useBulkSelection(webhookKeys);

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete webhook?",
      description: `“${name}” will be removed and will stop running.`,
      confirmLabel: "Delete webhook",
      variant: "destructive",
    });
    if (!ok) return;
    deleteWebhook.mutate(id, {
      onSuccess: () => {
        toast({ title: "Webhook deleted", description: `"${name}" has been removed.` });
        router.refresh();
      },
      onError: (e: Error) =>
        toast({ title: "Could not delete webhook", description: e.message, variant: "destructive" }),
    });
  };
  const handleBulkDelete = async () => {
    const ids = webhooksBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected webhooks?",
      description: `Delete ${ids.length} webhook(s)?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    setIsBulkDeleting(true);
    try {
      await Promise.all(ids.map((id) => deleteWebhook.mutateAsync(id)));
      webhooksBulk.clear();
      toast({ title: "Webhooks deleted", description: `${ids.length} webhook(s) removed.` });
      router.refresh();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Could not delete selected webhooks.";
      toast({ title: "Could not delete selected webhooks", description: errorMessage, variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleCopyWebhookUrl = async (id: string, triggerUrl: string) => {
    try {
      await navigator.clipboard.writeText(triggerUrl);
      setCopiedWebhookId(id);
      window.setTimeout(() => setCopiedWebhookId((current) => (current === id ? null : current)), 1500);
      toast({ title: "Copied", description: "Trigger URL copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy URL.", variant: "destructive" });
    }
  };

  const handleToggleActive = (id: string, name: string, currentIsActive: boolean) => {
    updateWebhook.mutate(
      { id, isActive: !currentIsActive },
      {
        onSuccess: (updated) => {
          toast({
            title: updated.isActive ? "Activated" : "Deactivated",
            description: updated.isActive
              ? `"${name}" is now active.`
              : `"${name}" is now inactive.`,
          });
          router.refresh();
        },
        onError: (e: Error) =>
          toast({
            title: "Could not update webhook",
            description: e.message,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Webhooks</h1>
          <p className="text-muted-foreground">Manage inbound webhooks and actions.</p>
        </div>
        <Link href="/webhooks/create" className="btn-primary flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" /> New webhook
        </Link>
      </div>

      <div className="mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search webhooks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field !pl-10 w-full bg-card/50"
          />
        </div>
        {filtered.length > 0 && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <DockerBulkCheckbox
                checked={webhooksBulk.allSelected ? true : webhooksBulk.someSelected ? "indeterminate" : false}
                onCheckedChange={() => webhooksBulk.toggleAllFiltered()}
                aria-label="Select all webhooks on this page"
              />
              <span className="text-sm text-muted-foreground">
                Select all on this page ({filtered.length})
              </span>
            </div>
            {webhooksBulk.selectedInFiltered.length > 0 && (
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting || deleteWebhook.isPending}
                className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
              >
                {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete ({webhooksBulk.selectedInFiltered.length})
              </button>
            )}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <Webhook className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No webhooks yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No webhooks match your search." : "Create your first webhook trigger to run actions."}
          </p>
          {!search && (
            <Link href="/webhooks/create" className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> New webhook
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((w) => (
            <div
              key={w.id}
              className="glass-panel backdrop-blur-none rounded-2xl p-5 flex flex-col gap-3 group interactive-card border border-white/10 hover:border-primary/30 transition-colors"
            >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`p-2 rounded-lg flex-shrink-0 ${
                        w.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Webhook className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-semibold text-lg leading-tight truncate" title={w.name}>
                          {w.name}
                        </h3>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0 ${
                            w.isActive
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-muted text-muted-foreground border border-white/10"
                          }`}
                        >
                          {w.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(w.id, w.name, w.isActive)}
                      disabled={isBulkDeleting || deleteWebhook.isPending || updateWebhook.isPending}
                      className={`p-2 rounded-md transition-colors opacity-0 group-hover:opacity-100 ${
                        w.isActive
                          ? "hover:bg-amber-500/20 text-amber-400"
                          : "hover:bg-emerald-500/20 text-emerald-400"
                      }`}
                      title={w.isActive ? "Deactivate" : "Activate"}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(w.id, w.name)}
                      disabled={isBulkDeleting || deleteWebhook.isPending || updateWebhook.isPending}
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div
                      className={`transition-opacity ${
                        webhooksBulk.selected.has(w.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <DockerBulkCheckbox
                        checked={webhooksBulk.selected.has(w.id)}
                        onCheckedChange={() => webhooksBulk.toggle(w.id)}
                        aria-label={`Select webhook ${w.name}`}
                      />
                    </div>
                  </div>
                </div>

                {w.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{w.description}</p>
                )}

                {w.remoteTriggerUrl && (
                  <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground mb-1.5">Trigger URL (deploy server)</p>
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-xs text-foreground/90 truncate font-mono" title={w.remoteTriggerUrl}>
                        {w.remoteTriggerUrl}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopyWebhookUrl(w.id, w.remoteTriggerUrl!)}
                        className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                        title="Copy trigger URL"
                        aria-label={`Copy trigger URL for ${w.name}`}
                      >
                        {copiedWebhookId === w.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateUTC(w.createdAt)}
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={`/webhooks/${w.id}/edit`}>
                      <span className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
                        Edit <Pencil className="w-3 h-3" />
                      </span>
                    </Link>
                    <Link href={`/webhooks/${w.id}`}>
                      <span className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
                        View <ChevronRight className="w-3 h-3" />
                      </span>
                    </Link>
                  </div>
                </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
