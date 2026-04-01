"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, Plus, Search, Trash2, ChevronRight, Clock, Pencil, Loader2 } from "lucide-react";
import { useDeleteCronJob } from "@/hooks/use-cron-jobs";
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
  const cronJobKeys = useMemo(() => filtered.map((j) => j.id), [filtered]);
  const cronJobsBulk = useBulkSelection(cronJobKeys);

  const handleDelete = async (id: string, name: string) => {
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
      await Promise.all(ids.map((id) => deleteCronJob.mutateAsync(id)));
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
              className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col group interactive-card"
            >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${j.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Clock3 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-lg leading-tight truncate" title={j.name}>
                        {j.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1 truncate" title={j.summary}>
                        {j.summary}
                      </p>
                      <p className="text-[11px] text-primary mt-1 font-mono">{j.cronExpression}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(j.id, j.name)}
                      disabled={isBulkDeleting || deleteCronJob.isPending}
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div
                      className={`transition-opacity ${
                        cronJobsBulk.selected.has(j.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <DockerBulkCheckbox
                        checked={cronJobsBulk.selected.has(j.id)}
                        onCheckedChange={() => cronJobsBulk.toggle(j.id)}
                        aria-label={`Select cron job ${j.name}`}
                      />
                    </div>
                  </div>
                </div>

                {j.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{j.description}</p>
                )}

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
