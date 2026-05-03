"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { Webhook, Plus, Search, Trash2, Clock, Pencil, Loader2, Copy, Check, Play, ScrollText, X } from "lucide-react";
import { useDeleteWebhook } from "@/hooks/use-webhooks";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import {
  fetchWebhookLastRunLog,
  publicWebhookTriggerUrl,
  webhookRouteId,
  type WebhookListItem,
} from "@/lib/webhooks-api";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useAuth } from "@/contexts/auth-context";
import { markPendingDeletion, reconcileAndFilterPendingDeletions } from "@/lib/pending-deletions";
import { useOptionalOrgWorkspace } from "@/(platform)/organizations/[publicId]/org-workspace-context";
import {
  orgMemberAllowsWebhooksAdd,
  orgMemberAllowsWebhooksDelete,
  orgMemberAllowsWebhooksEdit,
  orgMemberAllowsWebhooksLogs,
  orgMemberAllowsWebhooksRun,
} from "@/lib/org-workspace-permissions";

function formatDateUTC(dateInput: string): string {
  const date = new Date(dateInput);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function WebhooksClient({
  initialWebhooks,
  organizationPublicId = undefined,
}: {
  initialWebhooks: WebhookListItem[];
  organizationPublicId?: string;
}) {
  const orgTrim = organizationPublicId?.trim();
  const webhooksBasePath =
    orgTrim != null && orgTrim !== ""
      ? `/organizations/${encodeURIComponent(orgTrim)}/webhooks`
      : "/webhooks";
  const inOrgWebhooks = orgTrim != null && orgTrim !== "";
  const orgWorkspace = useOptionalOrgWorkspace();
  const allowWebhooksAdd =
    !inOrgWebhooks ||
    (orgWorkspace != null && orgMemberAllowsWebhooksAdd(orgWorkspace.workspacePermissions));
  const allowWebhooksEdit =
    !inOrgWebhooks ||
    (orgWorkspace != null && orgMemberAllowsWebhooksEdit(orgWorkspace.workspacePermissions));
  const allowWebhooksLogs =
    !inOrgWebhooks ||
    (orgWorkspace != null && orgMemberAllowsWebhooksLogs(orgWorkspace.workspacePermissions));
  const allowWebhooksRun =
    !inOrgWebhooks ||
    (orgWorkspace != null && orgMemberAllowsWebhooksRun(orgWorkspace.workspacePermissions));
  const allowWebhooksDelete =
    !inOrgWebhooks ||
    (orgWorkspace != null && orgMemberAllowsWebhooksDelete(orgWorkspace.workspacePermissions));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [webhooks, setWebhooks] = useState<WebhookListItem[]>(initialWebhooks);
  useLayoutEffect(() => {
    setWebhooks(
      reconcileAndFilterPendingDeletions("webhooks", initialWebhooks, (w) => [w.id, w.publicId]),
    );
  }, [initialWebhooks]);
  const deleteWebhook = useDeleteWebhook(organizationPublicId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const { accessToken } = useAuth();
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [copiedWebhookId, setCopiedWebhookId] = useState<number | null>(null);
  const [openLogWebhookId, setOpenLogWebhookId] = useState<number | null>(null);
  const [logTextByWebhookId, setLogTextByWebhookId] = useState<Record<number, string>>({});
  const [loadingLogWebhookId, setLoadingLogWebhookId] = useState<number | null>(null);
  const [triggeringWebhookId, setTriggeringWebhookId] = useState<number | null>(null);
  const [runLogLoadingWebhookId, setRunLogLoadingWebhookId] = useState<number | null>(null);
  const [provisioningWebhookIds, setProvisioningWebhookIds] = useState<number[]>([]);
  /** Must survive `router.replace` (searchParams change) — that re-runs the effect and would cancel a cleanup-bound timer. */
  const provisioningClearTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      for (const t of provisioningClearTimersRef.current) window.clearTimeout(t);
      provisioningClearTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const raw = (searchParams.get("provisioning") ?? "").trim();
    if (!raw) return;
    const ids = raw
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (ids.length === 0) return;
    setProvisioningWebhookIds((prev) => Array.from(new Set([...prev, ...ids])));
    setTimeout(() => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("provisioning");
      const q = sp.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }, 0);
    const timer = setTimeout(() => {
      setProvisioningWebhookIds((prev) => prev.filter((id) => !ids.includes(id)));
    }, 15000);
    provisioningClearTimersRef.current.push(timer);
  }, [searchParams, pathname, router]);

  const filtered =
    (webhooks ?? []).filter(
      (w) =>
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        (w.description || "").toLowerCase().includes(search.toLowerCase()) ||
        w.summary.toLowerCase().includes(search.toLowerCase()),
    );
  const webhookKeys = useMemo(() => filtered.map((w) => webhookRouteId(w)), [filtered]);
  const webhooksBulk = useBulkSelection(webhookKeys);

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete webhook?",
      description: `“${name}” will be removed and will stop running.`,
      confirmLabel: "Delete webhook",
      variant: "destructive",
    });
    if (!ok) return;
    const target = webhooks.find((item) => webhookRouteId(item) === id);
    markPendingDeletion("webhooks", id, target?.id, target?.publicId);
    const previous = webhooks;
    setWebhooks((prev) => prev.filter((item) => webhookRouteId(item) !== id));
    toast({ title: "Webhook deleted", description: `"${name}" has been removed.` });
    deleteWebhook.mutate(id, {
      onSuccess: () => undefined,
      onError: (e: Error) => {
        setWebhooks(previous);
        toast({ title: "Could not delete webhook", description: e.message, variant: "destructive" });
      },
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
    const previous = webhooks;
    const removed = new Set(ids);
    const selectedRows = webhooks.filter((item) => removed.has(webhookRouteId(item)));
    markPendingDeletion(
      "webhooks",
      ...ids,
      ...selectedRows.flatMap((item) => [item.id, item.publicId]),
    );
    setWebhooks((prev) => prev.filter((item) => !removed.has(webhookRouteId(item))));
    webhooksBulk.clear();
    toast({ title: "Webhooks deleted", description: `${ids.length} webhook(s) removed.` });
    try {
      await Promise.all(ids.map((id) => deleteWebhook.mutateAsync(id)));
    } catch (e) {
      setWebhooks(previous);
      const errorMessage = e instanceof Error ? e.message : "Could not delete selected webhooks.";
      toast({ title: "Could not delete selected webhooks", description: errorMessage, variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleCopyWebhookUrl = async (id: number, triggerUrl: string) => {
    try {
      await navigator.clipboard.writeText(triggerUrl);
      setCopiedWebhookId(id);
      window.setTimeout(() => setCopiedWebhookId((current) => (current === id ? null : current)), 1500);
      toast({ title: "Copied", description: "Trigger URL copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy URL.", variant: "destructive" });
    }
  };

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const loadWebhookLog = async (
    webhook: WebhookListItem,
    opts?: { silent?: boolean; keepModalState?: boolean; useButtonLoading?: boolean },
  ) => {
    if (provisioningWebhookIds.includes(webhook.id)) return;
    if (!accessToken) return;
    if (inOrgWebhooks && !allowWebhooksLogs) {
      if (!opts?.silent) {
        toast({
          title: "Logs not allowed",
          description: "Your role cannot view webhook logs in this organization.",
          variant: "destructive",
        });
      }
      return;
    }
    const useButtonLoading = opts?.useButtonLoading !== false;
    if (useButtonLoading && loadingLogWebhookId === webhook.id) return;
    if (!opts?.keepModalState) {
      setOpenLogWebhookId(webhook.id);
      setLogTextByWebhookId((prev) => ({ ...prev, [webhook.id]: "" }));
    }
    if (useButtonLoading) {
      setLoadingLogWebhookId(webhook.id);
    }
    try {
      const out = await fetchWebhookLastRunLog(
        accessToken,
        webhookRouteId(webhook),
        2000,
        organizationPublicId,
      );
      const normalized = out.log.trim();
      if (out.source === "executor-redeploy") {
        setLogTextByWebhookId((prev) => ({
          ...prev,
          [webhook.id]:
            "This webhook runs via internal redeploy flow, so no remote script log file is generated for it.",
        }));
      } else if (out.source === "not-applicable") {
        setLogTextByWebhookId((prev) => ({
          ...prev,
          [webhook.id]: "This webhook type does not produce a remote script log.",
        }));
      } else if (normalized) {
        setLogTextByWebhookId((prev) => ({
          ...prev,
          [webhook.id]: normalized,
        }));
      } else {
        setLogTextByWebhookId((prev) => {
          const prevText = (prev[webhook.id] ?? "").trim();
          if (prevText) return prev;
          return { ...prev, [webhook.id]: "" };
        });
      }
    } catch (e) {
      if (!opts?.silent) {
        toast({
          title: "Could not load log",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    } finally {
      if (useButtonLoading) {
        setLoadingLogWebhookId(null);
      }
    }
  };

  const triggerWebhookNow = async (webhook: WebhookListItem) => {
    if (provisioningWebhookIds.includes(webhook.id)) return;
    if (triggeringWebhookId === webhook.id) return;
    if (inOrgWebhooks && !allowWebhooksRun) {
      toast({
        title: "Run not allowed",
        description: "Your role cannot run webhooks from the UI in this organization.",
        variant: "destructive",
      });
      return;
    }
    setTriggeringWebhookId(webhook.id);
    setOpenLogWebhookId(webhook.id);
    setLogTextByWebhookId((prev) => ({ ...prev, [webhook.id]: "" }));
    setRunLogLoadingWebhookId(webhook.id);
    try {
      const triggerUrl =
        (webhook.remoteTriggerUrl ?? "").trim() || publicWebhookTriggerUrl(webhook.secretToken);
      const parsed = new URL(triggerUrl, window.location.origin);
      const isSameOrigin = parsed.origin === window.location.origin;
      if (isSameOrigin) {
        const res = await fetch(triggerUrl, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Trigger failed (${res.status})`);
        }
      } else {
        // Cross-origin webhook domains may block browser CORS reads even though the trigger executes.
        await fetch(triggerUrl, {
          method: "GET",
          mode: "no-cors",
          credentials: "omit",
          cache: "no-store",
        });
      }
      await sleep(900);
      await loadWebhookLog(webhook, {
        silent: true,
        keepModalState: true,
        useButtonLoading: false,
      });
    } catch (e) {
      toast({
        title: "Trigger failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setTriggeringWebhookId(null);
      setRunLogLoadingWebhookId(null);
    }
  };

  useEffect(() => {
    if (openLogWebhookId == null || !accessToken) return;
    if (inOrgWebhooks && !allowWebhooksLogs) return;
    const webhook = webhooks.find((w) => w.id === openLogWebhookId);
    if (!webhook) return;

    void loadWebhookLog(webhook, { silent: true, keepModalState: true });
    const timer = window.setInterval(() => {
      void loadWebhookLog(webhook, { silent: true, keepModalState: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [openLogWebhookId, accessToken, webhooks, inOrgWebhooks, allowWebhooksLogs]);

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Webhooks</h1>
          <p className="text-muted-foreground">Manage inbound webhooks and actions.</p>
        </div>
        {allowWebhooksAdd ? (
          <Link
            href={`${webhooksBasePath}/create`}
            className="btn-primary flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> New webhook
          </Link>
        ) : (
          <span
            className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2 text-sm text-muted-foreground"
            title="Your role cannot create webhooks in this organization"
          >
            <Plus className="w-5 h-5" /> New webhook
          </span>
        )}
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
        {filtered.length > 0 && allowWebhooksDelete && (
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
          <div className="w-20 h-20 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-6">
            <Webhook className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No webhooks yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No webhooks match your search." : "Create your first webhook trigger to run actions."}
          </p>
          {!search && allowWebhooksAdd && (
            <Link href={`${webhooksBasePath}/create`} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> New webhook
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((w) => (
            (() => {
              const isProvisioning = provisioningWebhookIds.includes(w.id);
              return (
            <div
              key={w.id}
              className={`relative glass-panel backdrop-blur-none rounded-2xl p-5 flex flex-col gap-3 group interactive-card border transition-colors ${
                isProvisioning
                  ? "border-sky-300/70 shadow-[0_0_0_1px_rgba(125,211,252,0.5),0_0_20px_rgba(56,189,248,0.3),inset_0_0_16px_rgba(56,189,248,0.15)]"
                  : "border-slate-200 hover:border-primary/35"
              }`}
            >
                {isProvisioning ? (
                  <div
                    className="absolute inset-0 z-20 cursor-not-allowed rounded-2xl"
                    aria-hidden="true"
                    title="Preparing webhook"
                  />
                ) : null}
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 rounded-lg flex-shrink-0 border bg-primary/10 text-primary border-primary/20">
                      <Webhook className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-semibold text-lg leading-tight truncate" title={w.name}>
                          {w.name}
                        </h3>
                        {isProvisioning ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0 bg-sky-500/15 text-sky-200 border border-sky-300/50">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Preparing
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDelete(webhookRouteId(w), w.name)}
                      disabled={
                        isProvisioning ||
                        isBulkDeleting ||
                        deleteWebhook.isPending ||
                        !allowWebhooksDelete
                      }
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
                      title={
                        allowWebhooksDelete
                          ? "Delete"
                          : "Your role cannot delete webhooks in this organization"
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {allowWebhooksDelete ? (
                      <div
                        className={`transition-opacity ${
                          webhooksBulk.selected.has(webhookRouteId(w))
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <DockerBulkCheckbox
                          checked={webhooksBulk.selected.has(webhookRouteId(w))}
                          onCheckedChange={() => {
                            if (isProvisioning) return;
                            webhooksBulk.toggle(webhookRouteId(w));
                          }}
                          aria-label={`Select webhook ${w.name}`}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <p className="text-sm line-clamp-2 text-muted-foreground">
                  {(w.description || "").trim() || "No description"}
                </p>

                {w.remoteTriggerUrl && (
                  <div
                    className={`rounded-lg border px-3 py-2.5 ${
                      isProvisioning
                        ? "border-slate-200 bg-slate-100 opacity-55 pointer-events-none select-none dark:border-white/5 dark:bg-black/10"
                        : "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-black/20"
                    }`}
                  >
                    <p className="text-[11px] mb-1.5 text-muted-foreground">
                      Trigger URL (deploy server)
                    </p>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-xs truncate font-mono text-foreground/90" title={w.remoteTriggerUrl}>
                        {w.remoteTriggerUrl}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopyWebhookUrl(w.id, w.remoteTriggerUrl!)}
                        disabled={isProvisioning}
                        className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                        title="Copy trigger URL"
                        aria-label={`Copy trigger URL for ${w.name}`}
                      >
                        {copiedWebhookId === w.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-auto pt-4 border-t border-slate-200 dark:border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateUTC(w.createdAt)}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 justify-end">
                    {isProvisioning ? (
                      <span className="text-muted-foreground/70 font-medium flex items-center gap-1 cursor-not-allowed">
                        Edit <Pencil className="w-3 h-3" />
                      </span>
                    ) : allowWebhooksEdit ? (
                      <Link href={`${webhooksBasePath}/${webhookRouteId(w)}/edit`}>
                        <span className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
                          Edit <Pencil className="w-3 h-3" />
                        </span>
                      </Link>
                    ) : (
                      <span
                        className="cursor-not-allowed font-medium text-muted-foreground/70 flex items-center gap-1"
                        title="Your role cannot edit webhooks in this organization"
                      >
                        Edit <Pencil className="w-3 h-3" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadWebhookLog(w)}
                      disabled={isProvisioning || !allowWebhooksLogs}
                      title={
                        allowWebhooksLogs
                          ? undefined
                          : "Your role cannot view webhook logs in this organization"
                      }
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                    >
                      Logs
                      <ScrollText className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void triggerWebhookNow(w)}
                      disabled={isProvisioning || !allowWebhooksRun}
                      title={
                        allowWebhooksRun
                          ? undefined
                          : "Your role cannot run webhooks from the UI in this organization"
                      }
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                    >
                      Run
                      <Play className="w-3 h-3" />
                    </button>
                  </div>
                </div>
            </div>
              );
            })()
          ))}
        </div>
      )}
      {openLogWebhookId != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex min-h-[100dvh] items-end justify-center overflow-y-auto p-0 modal-scrim sm:items-center sm:p-4"
            onClick={() => setOpenLogWebhookId(null)}
          >
            <div
              className="glass-panel flex max-h-[calc(100dvh-env(safe-area-inset-bottom))] w-full max-w-4xl flex-col space-y-3 rounded-t-2xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:max-h-[90vh] sm:rounded-2xl sm:p-5 sm:pb-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Webhook Logs</h3>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground sm:text-xs">
                    {webhooks.find((x) => x.id === openLogWebhookId)?.name ?? "Webhook"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenLogWebhookId(null)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 dark:hover:bg-white/10 hover:text-foreground"
                    aria-label="Close logs"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <pre className="h-[52dvh] min-h-[220px] w-full max-h-[60dvh] overflow-auto rounded-lg border border-border/50 bg-slate-100 text-slate-900 dark:bg-zinc-950 dark:text-foreground px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all sm:h-[62vh] sm:max-h-none sm:min-h-[360px]">
                {(() => {
                  const current = logTextByWebhookId[openLogWebhookId] ?? "";
                  if (
                    !current &&
                    (triggeringWebhookId === openLogWebhookId ||
                      loadingLogWebhookId === openLogWebhookId ||
                      runLogLoadingWebhookId === openLogWebhookId)
                  ) {
                    return "Loading latest run output...";
                  }
                  return current || "No log loaded.";
                })()}
              </pre>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
