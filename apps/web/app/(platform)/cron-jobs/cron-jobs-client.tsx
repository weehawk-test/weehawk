"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import {
  CirclePause,
  CirclePlay,
  Clock3,
  Plus,
  Search,
  Trash2,
  Clock,
  Pencil,
  Loader2,
  Play,
  ScrollText,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCronJobs, useDeleteCronJob, useUpdateCronJob } from "@/hooks/use-cron-jobs";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import {
  cronJobRouteId,
  fetchCronJobLastRunLog,
  triggerCronJobNow,
  type CronJobListItem,
} from "@/lib/cron-jobs-api";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useAuth } from "@/contexts/auth-context";
import { markPendingDeletion } from "@/lib/pending-deletions";
import { useOptionalOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import {
  orgMemberAllowsCronJobsAdd,
  orgMemberAllowsCronJobsDelete,
  orgMemberAllowsCronJobsEdit,
  orgMemberAllowsCronJobsLogs,
  orgMemberAllowsCronJobsRun,
} from "@/lib/org-workspace-permissions";
import { ORG_DATA_CHANGED_EVENT, type OrgDataChangedDetail } from "@/lib/org-realtime-events";

function formatDateUTC(dateInput: string): string {
  const date = new Date(dateInput);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function CronJobsClient({
  initialJobs,
  organizationPublicId: organizationPublicIdProp,
}: {
  initialJobs: CronJobListItem[];
  organizationPublicId?: string;
}) {
  const organizationPublicId = organizationPublicIdProp?.trim() || undefined;
  const cronJobsBasePath = "/cron-jobs";
  const inOrgCron =
    organizationPublicId != null && organizationPublicId !== "";
  const orgWorkspace = useOptionalOrgWorkspace();
  const allowCronAdd =
    !inOrgCron ||
    (orgWorkspace != null && orgMemberAllowsCronJobsAdd(orgWorkspace.workspacePermissions));
  const allowCronEdit =
    !inOrgCron ||
    (orgWorkspace != null && orgMemberAllowsCronJobsEdit(orgWorkspace.workspacePermissions));
  const allowCronLogs =
    !inOrgCron ||
    (orgWorkspace != null && orgMemberAllowsCronJobsLogs(orgWorkspace.workspacePermissions));
  const allowCronRun =
    !inOrgCron ||
    (orgWorkspace != null && orgMemberAllowsCronJobsRun(orgWorkspace.workspacePermissions));
  const allowCronDelete =
    !inOrgCron ||
    (orgWorkspace != null && orgMemberAllowsCronJobsDelete(orgWorkspace.workspacePermissions));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const orgKeyForQuery = organizationPublicId ?? "";
  const cronJobsQuery = useCronJobs(orgKeyForQuery || undefined, { initialData: initialJobs });
  const jobs = cronJobsQuery.data ?? initialJobs;
  const deleteCronJob = useDeleteCronJob(organizationPublicId);
  const updateCronJob = useUpdateCronJob(organizationPublicId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const { accessToken } = useAuth();
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [provisioningCronJobIds, setProvisioningCronJobIds] = useState<number[]>([]);
  const [openLogCronJobId, setOpenLogCronJobId] = useState<number | null>(null);
  const [logTextByCronJobId, setLogTextByCronJobId] = useState<Record<number, string>>({});
  const [loadingLogCronJobId, setLoadingLogCronJobId] = useState<number | null>(null);
  const [runningCronJobId, setRunningCronJobId] = useState<number | null>(null);
  const [runLogLoadingCronJobId, setRunLogLoadingCronJobId] = useState<number | null>(null);
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
    setProvisioningCronJobIds((prev) => Array.from(new Set([...prev, ...ids])));
    setTimeout(() => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("provisioning");
      const q = sp.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }, 0);
    const timer = setTimeout(() => {
      setProvisioningCronJobIds((prev) => prev.filter((id) => !ids.includes(id)));
    }, 15000);
    provisioningClearTimersRef.current.push(timer);
  }, [searchParams, pathname, router]);

  useEffect(() => {
    const PROVISIONING_MS = 15_000;
    const listener = (ev: Event) => {
      const d = (ev as CustomEvent<OrgDataChangedDetail>).detail;
      if (d?.entity !== "cron_job") return;
      const rid = d.resourceId;
      if (typeof rid !== "number" || !Number.isFinite(rid) || rid < 1) return;
      const id = Math.trunc(rid);
      if (d.action === "deleted") {
        setProvisioningCronJobIds((prev) => prev.filter((x) => x !== id));
        return;
      }
      if (d.action !== "created" && d.action !== "updated") return;
      setProvisioningCronJobIds((prev) => Array.from(new Set([...prev, id])));
      const timer = window.setTimeout(() => {
        setProvisioningCronJobIds((prev) => prev.filter((x) => x !== id));
      }, PROVISIONING_MS);
      provisioningClearTimersRef.current.push(timer);
    };
    window.addEventListener(ORG_DATA_CHANGED_EVENT, listener);
    return () => window.removeEventListener(ORG_DATA_CHANGED_EVENT, listener);
  }, []);

  const filtered =
    (jobs ?? []).filter(
      (j) =>
        j.name.toLowerCase().includes(search.toLowerCase()) ||
        (j.description || "").toLowerCase().includes(search.toLowerCase()) ||
        j.summary.toLowerCase().includes(search.toLowerCase()),
    );
  const cronJobKeys = useMemo(() => filtered.map((j) => cronJobRouteId(j)), [filtered]);
  const cronJobsBulk = useBulkSelection(cronJobKeys);

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete cron job?",
      description: `“${name}” will be removed and will stop running.`,
      confirmLabel: "Delete cron job",
      variant: "destructive",
    });
    if (!ok) return;
    const target = jobs.find((item) => cronJobRouteId(item) === id);
    markPendingDeletion("cron-jobs", id, target?.id, target?.publicId);
    toast({ title: "Cron job deleted", description: `"${name}" has been removed.` });
    deleteCronJob.mutate(id, {
      onSuccess: () => undefined,
      onError: (e: Error) => {
        toast({ title: "Could not delete cron job", description: e.message, variant: "destructive" });
      },
    });
  };
  const handleToggleCronJobActive = (j: CronJobListItem) => {
    if (!accessToken) return;
    if (inOrgCron && !allowCronEdit) {
      toast({
        title: "Not allowed",
        description: "Your role cannot change cron jobs in this organization.",
        variant: "destructive",
      });
      return;
    }
    updateCronJob.mutate(
      { id: j.id, isActive: !j.isActive },
      {
        onSuccess: (updated) => {
          const key = ["cron-jobs", orgKeyForQuery] as const;
          queryClient.setQueryData<CronJobListItem[]>(key, (old) =>
            (old ?? []).map((x) => (x.id === j.id ? { ...x, isActive: updated.isActive } : x)),
          );
          toast({
            title: updated.isActive ? "Activated" : "Deactivated",
            description: updated.isActive ? "This schedule will run again." : "This schedule is paused.",
          });
        },
        onError: (e: Error) =>
          toast({ title: "Update failed", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleBulkDelete = async () => {
    const ids = cronJobsBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected cron jobs?",
      description: `Delete ${ids.length} cron job(s)?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    setIsBulkDeleting(true);
    const removed = new Set(ids);
    const selectedRows = jobs.filter((item) => removed.has(cronJobRouteId(item)));
    markPendingDeletion(
      "cron-jobs",
      ...ids,
      ...selectedRows.flatMap((item) => [item.id, item.publicId]),
    );
    cronJobsBulk.clear();
    toast({ title: "Cron jobs deleted", description: `${ids.length} cron job(s) removed.` });
    try {
      await Promise.all(ids.map((id) => deleteCronJob.mutateAsync(id)));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Could not delete selected cron jobs.";
      toast({ title: "Could not delete selected cron jobs", description: errorMessage, variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const loadCronJobLog = async (
    cronJob: CronJobListItem,
    opts?: { silent?: boolean; keepModalState?: boolean; useButtonLoading?: boolean },
  ) => {
    if (provisioningCronJobIds.includes(cronJob.id)) return;
    if (!accessToken) return;
    if (!organizationPublicId?.trim()) {
      if (!opts?.silent) {
        toast({
          title: "Organization required",
          description: "Select an organization to load cron job logs.",
          variant: "destructive",
        });
      }
      return;
    }
    if (inOrgCron && !allowCronLogs) {
      if (!opts?.silent) {
        toast({
          title: "Logs not allowed",
          description: "Your role cannot view cron job logs in this organization.",
          variant: "destructive",
        });
      }
      return;
    }
    const useButtonLoading = opts?.useButtonLoading !== false;
    if (useButtonLoading && loadingLogCronJobId === cronJob.id) return;
    if (!opts?.keepModalState) {
      setOpenLogCronJobId(cronJob.id);
      setLogTextByCronJobId((prev) => ({ ...prev, [cronJob.id]: "" }));
    }
    if (useButtonLoading) {
      setLoadingLogCronJobId(cronJob.id);
    }
    try {
      const out = await fetchCronJobLastRunLog(
        accessToken,
        cronJobRouteId(cronJob),
        2000,
        organizationPublicId,
      );
      const normalized = out.log.trim();
      if (out.source === "not-applicable") {
        setLogTextByCronJobId((prev) => ({
          ...prev,
          [cronJob.id]: "This cron job type does not produce a remote script log.",
        }));
      } else if (normalized) {
        setLogTextByCronJobId((prev) => ({
          ...prev,
          [cronJob.id]: normalized,
        }));
      } else {
        setLogTextByCronJobId((prev) => {
          const prevText = (prev[cronJob.id] ?? "").trim();
          if (prevText) return prev;
          return { ...prev, [cronJob.id]: "" };
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
        setLoadingLogCronJobId(null);
      }
    }
  };

  const runCronJobNow = async (cronJob: CronJobListItem) => {
    if (provisioningCronJobIds.includes(cronJob.id)) return;
    if (!accessToken) return;
    if (runningCronJobId === cronJob.id) return;
    if (inOrgCron && !allowCronRun) {
      toast({
        title: "Run not allowed",
        description: "Your role cannot run cron jobs on demand in this organization.",
        variant: "destructive",
      });
      return;
    }
    setRunningCronJobId(cronJob.id);
    setOpenLogCronJobId(cronJob.id);
    setLogTextByCronJobId((prev) => ({ ...prev, [cronJob.id]: "" }));
    setRunLogLoadingCronJobId(cronJob.id);
    try {
      await triggerCronJobNow(accessToken, cronJobRouteId(cronJob), organizationPublicId);
      await sleep(900);
      await loadCronJobLog(cronJob, {
        silent: true,
        keepModalState: true,
        useButtonLoading: false,
      });
    } catch (e) {
      toast({
        title: "Run failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setRunningCronJobId(null);
      setRunLogLoadingCronJobId(null);
    }
  };

  useEffect(() => {
    if (openLogCronJobId == null || !accessToken) return;
    if (inOrgCron && !allowCronLogs) return;
    const cronJob = jobs.find((j) => j.id === openLogCronJobId);
    if (!cronJob) return;

    void loadCronJobLog(cronJob, { silent: true, keepModalState: true });
    const timer = window.setInterval(() => {
      void loadCronJobLog(cronJob, { silent: true, keepModalState: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [openLogCronJobId, accessToken, jobs, organizationPublicId, inOrgCron, allowCronLogs]);

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Cron Jobs</h1>
          <p className="text-muted-foreground">Manage scheduled automation jobs.</p>
        </div>
        {allowCronAdd ? (
          <Link
            href={`${cronJobsBasePath}/create`}
            className="btn-primary flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> New cron job
          </Link>
        ) : (
          <span
            className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2 text-sm text-muted-foreground"
            title="Your role cannot create cron jobs in this organization"
          >
            <Plus className="w-5 h-5" /> New cron job
          </span>
        )}
      </div>

      <div className="mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search cron jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field !pl-10 w-full bg-card/50"
          />
        </div>
        {filtered.length > 0 && allowCronDelete && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <DockerBulkCheckbox
                checked={cronJobsBulk.allSelected ? true : cronJobsBulk.someSelected ? "indeterminate" : false}
                onCheckedChange={() => cronJobsBulk.toggleAllFiltered()}
                aria-label="Select all cron jobs on this page"
              />
              <span className="text-sm text-muted-foreground">
                Select all on this page ({filtered.length})
              </span>
            </div>
            {cronJobsBulk.selectedInFiltered.length > 0 && (
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting || deleteCronJob.isPending}
                className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
              >
                {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete ({cronJobsBulk.selectedInFiltered.length})
              </button>
            )}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-6">
            <Clock3 className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No cron jobs yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No cron jobs match your search." : "Create your first cron job trigger."}
          </p>
          {!search && allowCronAdd && (
            <Link href={`${cronJobsBasePath}/create`} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> New cron job
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((j) => (
            (() => {
              const isProvisioning = provisioningCronJobIds.includes(j.id);
              return (
            <div
              key={j.id}
              className={`relative glass-panel backdrop-blur-none rounded-2xl p-5 flex flex-col gap-3 group interactive-card border transition-colors ${
                isProvisioning
                  ? "border-sky-300/70 shadow-[0_0_0_1px_rgba(125,211,252,0.5),0_0_20px_rgba(56,189,248,0.3),inset_0_0_16px_rgba(56,189,248,0.15)]"
                  : !j.isActive
                    ? "border-slate-300 bg-slate-100/95 dark:border-zinc-950/95 dark:bg-black/80 saturate-[0.9] dark:shadow-[inset_0_0_48px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-slate-400 dark:hover:border-zinc-700/80"
                    : "border-slate-200 hover:border-primary/35"
              }`}
            >
                {isProvisioning ? (
                  <div
                    className="absolute inset-0 z-20 cursor-not-allowed rounded-2xl"
                    aria-hidden="true"
                    title="Preparing cron job"
                  />
                ) : null}
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`p-2 rounded-lg flex-shrink-0 border ${
                        j.isActive
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "bg-slate-200 text-slate-600 border-slate-300 dark:bg-black dark:text-zinc-500 dark:border-white/[0.06]"
                      }`}
                    >
                      <Clock3 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3
                          className={`font-semibold text-lg leading-tight truncate ${
                            !isProvisioning && !j.isActive ? "text-foreground/55" : ""
                          }`}
                          title={j.name}
                        >
                          {j.name}
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
                      onClick={() => handleDelete(cronJobRouteId(j), j.name)}
                      disabled={
                        isProvisioning ||
                        isBulkDeleting ||
                        deleteCronJob.isPending ||
                        !allowCronDelete
                      }
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
                      title={
                        allowCronDelete
                          ? "Delete"
                          : "Your role cannot delete cron jobs in this organization"
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {allowCronDelete ? (
                      <div
                        className={`transition-opacity ${
                          cronJobsBulk.selected.has(cronJobRouteId(j))
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <DockerBulkCheckbox
                          checked={cronJobsBulk.selected.has(cronJobRouteId(j))}
                          onCheckedChange={() => {
                            if (isProvisioning) return;
                            cronJobsBulk.toggle(cronJobRouteId(j));
                          }}
                          aria-label={`Select cron job ${j.name}`}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <p
                  className={`text-sm line-clamp-2 ${
                    !isProvisioning && !j.isActive
                      ? "text-muted-foreground/60"
                      : "text-muted-foreground"
                  }`}
                >
                  {(j.description || "").trim() || "No description"}
                </p>

                <div
                  className={`rounded-lg border px-3 py-2.5 ${
                    isProvisioning
                      ? "border-slate-200 bg-slate-100 opacity-55 pointer-events-none select-none dark:border-white/5 dark:bg-black/10"
                      : !j.isActive
                        ? "border-slate-300 bg-slate-200/90 dark:border-white/[0.05] dark:bg-black/70 dark:shadow-[inset_0_1px_8px_rgba(0,0,0,0.4)]"
                        : "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-black/20"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p
                      className={`text-[11px] ${
                        !isProvisioning && !j.isActive ? "text-muted-foreground/55" : "text-muted-foreground"
                      }`}
                    >
                      Cron schedule
                    </p>
                    {!isProvisioning ? (
                      <button
                        type="button"
                        onClick={() => handleToggleCronJobActive(j)}
                        disabled={updateCronJob.isPending || !allowCronEdit}
                        className="shrink-0 text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                        title={
                          allowCronEdit
                            ? j.isActive
                              ? "Pause schedule (deactivate)"
                              : "Resume schedule (activate)"
                            : "Your role cannot change cron jobs in this organization"
                        }
                        aria-label={j.isActive ? "Pause cron job schedule" : "Resume cron job schedule"}
                      >
                        {updateCronJob.isPending && updateCronJob.variables?.id === j.id ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden />
                            <span className="sr-only">Updating schedule</span>
                          </>
                        ) : (
                          <>
                            {j.isActive ? "Pause" : "Resume"}
                            {j.isActive ? (
                              <CirclePause className="w-3 h-3 shrink-0" aria-hidden />
                            ) : (
                              <CirclePlay className="w-3 h-3 shrink-0" aria-hidden />
                            )}
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                  <p
                    className={`text-xs truncate font-mono ${
                      !isProvisioning && !j.isActive ? "text-foreground/60" : "text-foreground/90"
                    }`}
                    title={j.cronExpression}
                  >
                    {j.cronExpression}
                  </p>
                </div>

                <div
                  className={`mt-auto pt-4 border-t flex items-center justify-between text-xs ${
                    !isProvisioning && !j.isActive
                      ? "border-slate-200 text-muted-foreground/80 dark:border-white/[0.04] dark:text-muted-foreground/70"
                      : "border-slate-200 text-muted-foreground dark:border-white/5"
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateUTC(j.createdAt)}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 justify-end">
                    {isProvisioning ? (
                      <span className="text-muted-foreground/70 font-medium flex items-center gap-1 cursor-not-allowed">
                        Edit <Pencil className="w-3 h-3" />
                      </span>
                    ) : allowCronEdit ? (
                      <Link href={`${cronJobsBasePath}/${cronJobRouteId(j)}/edit`}>
                        <span className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
                          Edit <Pencil className="w-3 h-3" />
                        </span>
                      </Link>
                    ) : (
                      <span
                        className="cursor-not-allowed font-medium text-muted-foreground/70 flex items-center gap-1"
                        title="Your role cannot edit cron jobs in this organization"
                      >
                        Edit <Pencil className="w-3 h-3" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadCronJobLog(j)}
                      disabled={isProvisioning || !allowCronLogs}
                      title={
                        allowCronLogs
                          ? undefined
                          : "Your role cannot view cron job logs in this organization"
                      }
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                    >
                      Logs
                      <ScrollText className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void runCronJobNow(j)}
                      disabled={isProvisioning || !allowCronRun}
                      title={
                        allowCronRun
                          ? undefined
                          : "Your role cannot run cron jobs on demand in this organization"
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
      {openLogCronJobId != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex min-h-[100dvh] items-end justify-center overflow-y-auto p-0 modal-scrim sm:items-center sm:p-4"
            onClick={() => setOpenLogCronJobId(null)}
          >
            <div
              className="glass-panel flex max-h-[calc(100dvh-env(safe-area-inset-bottom))] w-full max-w-4xl flex-col space-y-3 rounded-t-2xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:max-h-[90vh] sm:rounded-2xl sm:p-5 sm:pb-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Cron Job Logs</h3>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground sm:text-xs">
                    {jobs.find((x) => x.id === openLogCronJobId)?.name ?? "Cron job"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenLogCronJobId(null)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 dark:hover:bg-white/10 hover:text-foreground"
                    aria-label="Close logs"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <pre className="h-[52dvh] min-h-[220px] w-full max-h-[60dvh] overflow-auto rounded-lg border border-border/50 bg-slate-100 text-slate-900 dark:bg-zinc-950 dark:text-foreground px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all sm:h-[62vh] sm:max-h-none sm:min-h-[360px]">
                {(() => {
                  const current = logTextByCronJobId[openLogCronJobId] ?? "";
                  if (
                    !current &&
                    (runningCronJobId === openLogCronJobId ||
                      loadingLogCronJobId === openLogCronJobId ||
                      runLogLoadingCronJobId === openLogCronJobId)
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
