"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, Plus, Search, Trash2, ChevronRight, Clock, Pencil, Loader2, Power } from "lucide-react";
import { useDeleteCronJob, useUpdateCronJob } from "@/hooks/use-cron-jobs";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import type { CronJobListItem } from "@/lib/cron-jobs-api";
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

export function CronJobsClient({ initialJobs }: { initialJobs: CronJobListItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const jobs = initialJobs;
  const deleteCronJob = useDeleteCronJob();
  const updateCronJob = useUpdateCronJob();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const filtered =
    (jobs ?? []).filter(
      (j) =>
        j.name.toLowerCase().includes(search.toLowerCase()) ||
        (j.description || "").toLowerCase().includes(search.toLowerCase()) ||
        j.summary.toLowerCase().includes(search.toLowerCase()),
    );
  const cronJobKeys = useMemo(() => filtered.map((j) => String(j.id)), [filtered]);
  const cronJobsBulk = useBulkSelection(cronJobKeys);

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: "Delete cron job?",
      description: `“${name}” will be removed and will stop running.`,
      confirmLabel: "Delete cron job",
      variant: "destructive",
    });
    if (!ok) return;
    deleteCronJob.mutate(id, {
      onSuccess: () => {
        toast({ title: "Cron job deleted", description: `"${name}" has been removed.` });
        router.refresh();
      },
      onError: (e: Error) =>
        toast({ title: "Could not delete cron job", description: e.message, variant: "destructive" }),
    });
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
    try {
      await Promise.all(ids.map((id) => deleteCronJob.mutateAsync(Number(id))));
      cronJobsBulk.clear();
      toast({ title: "Cron jobs deleted", description: `${ids.length} cron job(s) removed.` });
      router.refresh();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Could not delete selected cron jobs.";
      toast({ title: "Could not delete selected cron jobs", description: errorMessage, variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleToggleActive = (id: number, name: string, currentIsActive: boolean) => {
    updateCronJob.mutate(
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
            title: "Could not update cron job",
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
          <h1 className="text-3xl font-bold text-foreground mb-2">Cron Jobs</h1>
          <p className="text-muted-foreground">Manage scheduled automation jobs.</p>
        </div>
        <Link href="/cron-jobs/create" className="btn-primary flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" /> New cron job
        </Link>
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
        {filtered.length > 0 && (
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
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <Clock3 className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No cron jobs yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No cron jobs match your search." : "Create your first cron job trigger."}
          </p>
          {!search && (
            <Link href="/cron-jobs/create" className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> New cron job
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((j) => (
            <div
              key={j.id}
              className="glass-panel backdrop-blur-none rounded-2xl p-5 flex flex-col gap-3 group interactive-card border border-white/10 hover:border-primary/30 transition-colors"
            >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${j.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Clock3 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-semibold text-lg leading-tight truncate" title={j.name}>
                          {j.name}
                        </h3>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0 ${
                            j.isActive
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-muted text-muted-foreground border border-white/10"
                          }`}
                        >
                          {j.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(j.id, j.name, j.isActive)}
                      disabled={isBulkDeleting || deleteCronJob.isPending || updateCronJob.isPending}
                      className={`p-2 rounded-md transition-colors opacity-0 group-hover:opacity-100 ${
                        j.isActive
                          ? "hover:bg-amber-500/20 text-amber-400"
                          : "hover:bg-emerald-500/20 text-emerald-400"
                      }`}
                      title={j.isActive ? "Deactivate" : "Activate"}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(j.id, j.name)}
                      disabled={isBulkDeleting || deleteCronJob.isPending || updateCronJob.isPending}
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div
                      className={`transition-opacity ${
                        cronJobsBulk.selected.has(String(j.id)) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <DockerBulkCheckbox
                        checked={cronJobsBulk.selected.has(String(j.id))}
                        onCheckedChange={() => cronJobsBulk.toggle(String(j.id))}
                        aria-label={`Select cron job ${j.name}`}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2">
                  {(j.description || "").trim() || "No description"}
                </p>

                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground mb-1.5">Cron schedule</p>
                  <p className="text-xs text-foreground/90 truncate font-mono" title={j.cronExpression}>
                    {j.cronExpression}
                  </p>
                </div>

                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateUTC(j.createdAt)}
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={`/cron-jobs/${j.id}/edit`}>
                      <span className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
                        Edit <Pencil className="w-3 h-3" />
                      </span>
                    </Link>
                    <Link href={`/cron-jobs/${j.id}`}>
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
