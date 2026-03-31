"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Clock3, Plus, Search, Trash2, ChevronRight, Clock, Pencil } from "lucide-react";
import { useDeleteCronJob } from "@/hooks/use-cron-jobs";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import type { CronJobListItem } from "@/lib/cron-jobs-api";

export function CronJobsClient({ initialJobs }: { initialJobs: CronJobListItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const jobs = initialJobs;
  const deleteCronJob = useDeleteCronJob();
  const { toast } = useToast();
  const confirm = useConfirm();

  const filtered =
    (jobs ?? []).filter(
      (j) =>
        j.name.toLowerCase().includes(search.toLowerCase()) ||
        (j.description || "").toLowerCase().includes(search.toLowerCase()) ||
        j.summary.toLowerCase().includes(search.toLowerCase()),
    );

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

      <div className="mb-8 relative">
        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search cron jobs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field !pl-12 max-w-md bg-card/50"
        />
      </div>

      {filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center text-center"
        >
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
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <AnimatePresence>
            {filtered.map((j) => (
              <motion.div
                key={j.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="glass-panel rounded-2xl p-6 flex flex-col group interactive-card"
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
                  <button
                    type="button"
                    onClick={() => handleDelete(j.id, j.name)}
                    className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {j.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{j.description}</p>
                )}

                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(j.createdAt), "MMM d, yyyy")}
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
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
