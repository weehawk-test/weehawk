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
        description: "The provision worker will connect over SSH. You can follow the log below.",
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
        description: "The provision worker will run the removal script over SSH. Follow the log below.",
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
      className="border-t border-border bg-muted/20"
      onToggle={(e) => setPanelOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="px-5 py-2.5 text-xs font-medium cursor-pointer select-none text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
        <span className="inline-block rotate-0 transition-transform [[open]_&]:rotate-90 text-[10px] opacity-60">
          ▸
        </span>
        Host install script &amp; Install
      </summary>
      <div className="px-5 pb-4 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          This is the same bash the{" "}
          <span className="text-foreground/90">provision-worker</span> runs over SSH. Review it, then opt in with the
          checkbox and <strong className="text-foreground/90">Install</strong>. Requires root or passwordless sudo on
          the server. Deploy hosts also initialize Swarm and the <code className="text-[10px]">weehawk</code> overlay.
        </p>
        {scriptQ.isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading script…
          </div>
        )}
        {scriptQ.isError && (
          <p className="text-xs text-red-400">{(scriptQ.error as Error).message}</p>
        )}
        {scriptQ.data?.script ? (
          <pre className="text-[10px] leading-snug font-mono overflow-x-auto max-h-52 overflow-y-auto rounded-lg border border-border bg-black/35 p-3 text-zinc-300">
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
            I want the platform to run this script on{" "}
            <strong className="text-foreground">{row.host}</strong> now (SSH using the stored key).
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!row.hasPrivateKey || !ack || enqueueMut.isPending}
            onClick={() => enqueueMut.mutate()}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-100 hover:bg-amber-500/20 disabled:opacity-40 disabled:pointer-events-none"
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
      className="border-t border-border bg-muted/15"
      onToggle={(e) => setPurgeOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="px-5 py-2.5 text-xs font-medium cursor-pointer select-none text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
        <span className="inline-block rotate-0 transition-transform [[open]_&]:rotate-90 text-[10px] opacity-60">
          ▸
        </span>
        Remove Docker (purge) — conflict cleanup
      </summary>
      <div className="px-5 pb-4 space-y-3">
        <p className="text-[11px] text-red-400/90 leading-relaxed border border-red-500/25 rounded-lg bg-red-500/5 p-2.5">
          <strong className="text-red-300">Destructive.</strong> Use only when apt or Docker is in a bad state (mixed
          versions, failed upgrades, downgrade errors). This stops containers, purges Docker packages on Debian/Ubuntu,
          deletes <code className="text-[10px]">/var/lib/docker</code>, <code className="text-[10px]">/var/lib/containerd</code>,{" "}
          <code className="text-[10px]">/etc/docker</code>, and your user&apos;s{" "}
          <code className="text-[10px]">~/.docker</code>. After it succeeds, use <strong>Install</strong> above for a clean
          engine. Requires root or passwordless sudo.
        </p>
        {purgeScriptQ.isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading script…
          </div>
        )}
        {purgeScriptQ.isError && (
          <p className="text-xs text-red-400">{(purgeScriptQ.error as Error).message}</p>
        )}
        {purgeScriptQ.data?.script ? (
          <pre className="text-[10px] leading-snug font-mono overflow-x-auto max-h-52 overflow-y-auto rounded-lg border border-border bg-black/35 p-3 text-zinc-300">
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
            <strong className="text-foreground">{row.host}</strong> and I want the platform to run the purge script now
            (SSH using the stored key).
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!row.hasPrivateKey || !purgeAck || purgeMut.isPending}
            onClick={() => purgeMut.mutate()}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/35 text-red-100 hover:bg-red-500/20 disabled:opacity-40 disabled:pointer-events-none"
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
      <div className="border-t border-border bg-muted/10 px-5 py-3">
        <div className="rounded-lg border border-border bg-black/25 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <p className="text-[11px] font-medium min-w-0">
              Job ({jobQ.data.jobKind === "docker_purge" ? "purge" : "install"}):{" "}
              <span className="font-mono text-[10px] opacity-80">{jobId.slice(0, 8)}…</span>
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
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/10"
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
            <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto text-zinc-400 leading-snug">
              {jobQ.data.log}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground">Waiting for log output…</p>
          )}
        </div>
      </div>
    ) : null}

    {jobId && jobQ.data && jobLogDismissed ? (
      <div className="border-t border-border bg-muted/10 px-5 py-2">
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
