"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  enqueueRemoteDockerPurgeApi,
  enqueueRemoteProvisionApi,
  fetchDockerPurgeScriptApi,
  fetchProvisionJobApi,
  fetchProvisionScriptApi,
  type RemoteServerRow,
} from "@/lib/remote-servers-api";
import { useToast } from "@/hooks/use-toast";

type Props = {
  accessToken: string;
  row: RemoteServerRow;
};

export function RemoteServerInstallBlock({ accessToken, row }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [panelOpen, setPanelOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [purgeAck, setPurgeAck] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLogDismissed, setJobLogDismissed] = useState(false);

  useEffect(() => {
    if (jobId) setJobLogDismissed(false);
  }, [jobId]);

  const scriptQ = useQuery({
    queryKey: ["provision-script", row.serverRole],
    queryFn: () => fetchProvisionScriptApi(accessToken, row.serverRole),
    enabled: panelOpen,
  });

  const purgeScriptQ = useQuery({
    queryKey: ["docker-purge-script"],
    queryFn: () => fetchDockerPurgeScriptApi(accessToken),
    enabled: purgeOpen,
  });

  const jobQ = useQuery({
    queryKey: ["provision-job", jobId],
    queryFn: () => fetchProvisionJobApi(accessToken, jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "pending" || s === "running") return 2000;
      return false;
    },
  });

  const enqueueMut = useMutation({
    mutationFn: () => enqueueRemoteProvisionApi(accessToken, row.id),
    onSuccess: (data) => {
      setJobId(data.jobId);
      void qc.invalidateQueries({ queryKey: ["provision-job"] });
      toast({
        title: "Install queued",
        description: "Connecting over SSH. Watch the log below.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not queue install", description: e.message, variant: "destructive" }),
  });

  const purgeMut = useMutation({
    mutationFn: () => enqueueRemoteDockerPurgeApi(accessToken, row.id),
    onSuccess: (data) => {
      setJobId(data.jobId);
      void qc.invalidateQueries({ queryKey: ["provision-job"] });
      toast({
        title: "Docker purge queued",
        description: "Removal runs over SSH. Follow the log below.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not queue purge", description: e.message, variant: "destructive" }),
  });

  const terminalOk = jobQ.data?.status === "done";
  const terminalErr = jobQ.data?.status === "error";

  return (
    <>
      <details
        className="border-t border-border bg-zinc-100/90 dark:bg-muted/20"
        onToggle={(e) => setPanelOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="px-4 py-2.5 text-xs font-medium cursor-pointer select-none text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden flex items-center gap-2 sm:px-5">
          <span className="inline-block rotate-0 transition-transform [[open]_&]:rotate-90 text-[10px] opacity-60">
            ▸
          </span>
          Server setup &amp; install
        </summary>
        <div className="space-y-3 px-4 pb-4 sm:px-5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {row.serverRole === "build" ? (
              <>
                Installs Docker if it is missing, starts it, and lets your SSH user run Docker — so this server can
                build container images for you.
              </>
            ) : (
              <>
                When needed, it installs Docker and the Weehawk agents, switches on Swarm, creates a shared network for
                your services, and opens the public web ports (80 and 443) so your deployments on this server are
                reachable.
              </>
            )}
          </p>
          {scriptQ.isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading script…
            </div>
          )}
          {scriptQ.isError && <p className="text-xs text-red-400">{(scriptQ.error as Error).message}</p>}
          {scriptQ.data?.script ? (
            <pre className="text-[10px] leading-snug font-mono overflow-x-auto max-h-52 overflow-y-auto rounded-lg border border-zinc-700/60 bg-zinc-950 p-3 text-zinc-200 shadow-inner dark:border-border dark:bg-zinc-950/90 dark:text-zinc-300">
              {scriptQ.data.script}
            </pre>
          ) : null}
          <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-border"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              I want the platform to run this script on <strong className="text-foreground">{row.host}</strong>.
            </span>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              disabled={!row.hasPrivateKey || !ack || enqueueMut.isPending}
              onClick={() => enqueueMut.mutate()}
              className="btn-primary inline-flex min-h-10 w-full items-center justify-center gap-1.5 text-xs disabled:pointer-events-none disabled:opacity-40 sm:min-h-0 sm:w-auto"
            >
              {enqueueMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Install
            </button>
            {!row.hasPrivateKey ? (
              <span className="text-[11px] text-amber-500/85">Save a private key for this host first.</span>
            ) : null}
          </div>
        </div>
      </details>

      <details
        className="border-t border-border bg-zinc-100/90 dark:bg-muted/15"
        onToggle={(e) => setPurgeOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="px-4 py-2.5 text-xs font-medium cursor-pointer select-none text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden flex items-center gap-2 sm:px-5">
          <span className="inline-block rotate-0 transition-transform [[open]_&]:rotate-90 text-[10px] opacity-60">
            ▸
          </span>
          Remove Docker (purge) — conflict cleanup
        </summary>
        <div className="space-y-3 px-4 pb-4 sm:px-5">
          <p className="text-[11px] text-red-400/90 leading-relaxed border border-red-500/25 rounded-lg bg-red-500/5 p-2.5">
            <strong className="text-red-300">Danger:</strong> removes Docker and all images and containers on this
            server. Use only if Docker is broken. Then use <strong className="text-red-200">Install</strong> above for a
            fresh setup. Needs admin (sudo) access.
          </p>
          {purgeScriptQ.isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading script…
            </div>
          )}
          {purgeScriptQ.isError && <p className="text-xs text-red-400">{(purgeScriptQ.error as Error).message}</p>}
          {purgeScriptQ.data?.script ? (
            <pre className="text-[10px] leading-snug font-mono overflow-x-auto max-h-52 overflow-y-auto rounded-lg border border-zinc-700/60 bg-zinc-950 p-3 text-zinc-200 shadow-inner dark:border-border dark:bg-zinc-950/90 dark:text-zinc-300">
              {purgeScriptQ.data.script}
            </pre>
          ) : null}
          <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-border"
              checked={purgeAck}
              onChange={(e) => setPurgeAck(e.target.checked)}
            />
            <span>
              I understand this will remove Docker and local image/container data on{" "}
              <strong className="text-foreground">{row.host}</strong> and I want the platform to run the purge script
              now.
            </span>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              disabled={!row.hasPrivateKey || !purgeAck || purgeMut.isPending}
              onClick={() => purgeMut.mutate()}
              className="btn-secondary inline-flex min-h-10 w-full items-center justify-center gap-1.5 border-destructive/40 bg-destructive/10 text-xs font-medium text-destructive hover:bg-destructive/15 disabled:pointer-events-none disabled:opacity-40 sm:min-h-0 sm:w-auto"
            >
              {purgeMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Run purge
            </button>
            {!row.hasPrivateKey ? (
              <span className="text-[11px] text-amber-500/85">Save a private key for this host first.</span>
            ) : null}
          </div>
        </div>
      </details>

      {jobId && jobQ.data && !jobLogDismissed ? (
        <div className="border-t border-border bg-zinc-100/80 px-4 py-3 dark:bg-muted/10 sm:px-5">
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-950 p-3 space-y-2 shadow-inner dark:border-border dark:bg-black/40">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <p className="text-[11px] font-medium min-w-0 text-zinc-100">
                Job ({jobQ.data.jobKind === "docker_purge" ? "purge" : "install"}):{" "}
                <span className="font-mono text-[10px] text-zinc-400">{jobId.slice(0, 8)}…</span>
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                    terminalOk
                      ? "border-emerald-500/35 text-emerald-300 bg-emerald-500/10"
                      : terminalErr
                        ? "border-red-500/35 text-red-300 bg-red-500/10"
                        : "border-amber-500/35 text-amber-200 bg-amber-500/10"
                  }`}
                >
                  {jobQ.data.status}
                </span>
                <button
                  type="button"
                  onClick={() => setJobLogDismissed(true)}
                  className="rounded-md p-1 text-zinc-400 hover:text-zinc-100 hover:bg-white/10"
                  aria-label="Close log"
                  title="Close log"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
            {jobQ.data.errorMessage ? (
              <p className="text-[11px] text-red-400 whitespace-pre-wrap">{jobQ.data.errorMessage}</p>
            ) : null}
            {jobQ.data.log ? (
              <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto text-zinc-300 leading-snug">
                {jobQ.data.log}
              </pre>
            ) : (
              <p className="text-[11px] text-zinc-400">Waiting for log output…</p>
            )}
          </div>
        </div>
      ) : null}

      {jobId && jobQ.data && jobLogDismissed ? (
        <div className="border-t border-border bg-zinc-100/80 px-4 py-2 dark:bg-muted/10 sm:px-5">
          <button
            type="button"
            onClick={() => setJobLogDismissed(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Show job log ({jobQ.data.jobKind === "docker_purge" ? "purge" : "install"} · {jobQ.data.status})
          </button>
        </div>
      ) : null}
    </>
  );
}
