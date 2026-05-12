"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock, Loader2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  enqueueRemoteDockerPurgeApi,
  enqueueRemoteNixpacksInstallApi,
  enqueueRemoteProvisionApi,
  enqueueRemoteTraefikRedeployApi,
  fetchDockerPurgeScriptApi,
  fetchNixpacksInstallScriptApi,
  fetchProvisionJobApi,
  fetchProvisionScriptApi,
  fetchTraefikRedeployScriptApi,
  type ProvisionJobKind,
  type RemoteServerRow,
} from "@/lib/remote-servers-api";
import { useToast } from "@/hooks/use-toast";
import { isSelfHostedBootstrapRemoteServer } from "@/lib/loopback-ssh-host";

type Props = {
  accessToken: string;
  row: RemoteServerRow;
  /** When false (e.g. org workspace), hide install/maintenance queue actions. Default true. */
  installMaintenanceAllowed?: boolean;
  /** Required for install-script preview (org-scoped Traefik ACME email). */
  activeOrgPublicIdForProvision?: string;
};

type InstallDialog = "provision" | "nixpacks" | "purge" | "traefik_redeploy" | null;

function remoteServerRouteId(row: Pick<RemoteServerRow, "id" | "publicId">): string {
  const pub = row.publicId?.trim();
  return pub && pub.length > 0 ? pub : String(row.id);
}

function provisionJobKindLabel(kind: ProvisionJobKind | undefined): string {
  if (kind === "docker_purge") return "purge";
  if (kind === "nixpacks_install") return "nixpacks";
  if (kind === "traefik_redeploy") return "traefik redeploy";
  return "install";
}

function formatCreatedAtLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Script preview: wrap long lines — no horizontal scrollbar */
const scriptPreviewPreClassName =
  "min-w-0 max-w-full text-[10px] leading-snug font-mono max-h-60 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-300 bg-slate-100 p-3 text-slate-800 shadow-inner dark:border-border dark:bg-zinc-950/90 dark:text-zinc-300";

export function RemoteServerInstallBlock({
  accessToken,
  row,
  installMaintenanceAllowed = true,
  activeOrgPublicIdForProvision = "",
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const showDockerPurgeOption = !isSelfHostedBootstrapRemoteServer({
    domainsJson: row.domainsJson,
    name: row.name,
    host: row.host,
    sshUser: row.sshUser,
    serverRole: row.serverRole,
  });
  const [installMenuOpen, setInstallMenuOpen] = useState(false);
  const [installDialog, setInstallDialog] = useState<InstallDialog>(null);
  const [ack, setAck] = useState(false);
  const [nixAck, setNixAck] = useState(false);
  const [purgeAck, setPurgeAck] = useState(false);
  const [traefikAck, setTraefikAck] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLogDismissed, setJobLogDismissed] = useState(false);
  const jobLogPreRef = useRef<HTMLPreElement | null>(null);
  /** When true, user scrolled away from the bottom — do not jump the log on poll updates. */
  const jobLogUserScrolledAwayRef = useRef(false);
  const jobLogWasDismissedRef = useRef(jobLogDismissed);

  useEffect(() => {
    if (jobId) setJobLogDismissed(false);
  }, [jobId]);

  useEffect(() => {
    jobLogUserScrolledAwayRef.current = false;
  }, [jobId]);

  const orgForProvision = activeOrgPublicIdForProvision.trim();
  const serverRouteId = row.publicId?.trim() || String(row.id);
  const scriptQ = useQuery({
    queryKey: ["provision-script", row.serverRole, orgForProvision, serverRouteId],
    queryFn: () => fetchProvisionScriptApi(accessToken, row.serverRole, serverRouteId),
    enabled: installDialog === "provision" && Boolean(orgForProvision),
  });

  const nixOnlyScriptQ = useQuery({
    queryKey: ["nixpacks-install-script"],
    queryFn: () => fetchNixpacksInstallScriptApi(accessToken),
    enabled: installDialog === "nixpacks",
  });

  const purgeScriptQ = useQuery({
    queryKey: ["docker-purge-script"],
    queryFn: () => fetchDockerPurgeScriptApi(accessToken),
    enabled: installDialog === "purge" && showDockerPurgeOption,
  });

  const traefikRedeployScriptQ = useQuery({
    queryKey: ["traefik-redeploy-script", serverRouteId],
    queryFn: () => fetchTraefikRedeployScriptApi(accessToken, serverRouteId),
    enabled: installDialog === "traefik_redeploy" && row.serverRole === "deploy",
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

  useLayoutEffect(() => {
    if (jobLogWasDismissedRef.current && !jobLogDismissed) {
      jobLogUserScrolledAwayRef.current = false;
    }
    jobLogWasDismissedRef.current = jobLogDismissed;
  }, [jobLogDismissed]);

  useLayoutEffect(() => {
    if (jobLogDismissed) return;
    const el = jobLogPreRef.current;
    const log = jobQ.data?.log;
    if (!el || !log) return;
    if (jobLogUserScrolledAwayRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [jobQ.data?.log, jobLogDismissed]);

  const openInstallFlow = (which: Exclude<InstallDialog, null>) => {
    setInstallMenuOpen(false);
    setInstallDialog(which);
  };

  const enqueueMut = useMutation({
    mutationFn: () => enqueueRemoteProvisionApi(accessToken, remoteServerRouteId(row)),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setInstallDialog(null);
      void qc.invalidateQueries({ queryKey: ["provision-job"] });
      toast({
        title: "Install queued",
        description: "Connecting over SSH. Watch the log below.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not queue install", description: e.message, variant: "destructive" }),
  });

  const nixpacksOnlyMut = useMutation({
    mutationFn: () => enqueueRemoteNixpacksInstallApi(accessToken, remoteServerRouteId(row)),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setInstallDialog(null);
      void qc.invalidateQueries({ queryKey: ["provision-job"] });
      toast({
        title: "Nixpacks install queued",
        description: "Runs over SSH on this host only. Watch the log below.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not queue Nixpacks install",
        description: e.message,
        variant: "destructive",
      }),
  });

  const purgeMut = useMutation({
    mutationFn: () => enqueueRemoteDockerPurgeApi(accessToken, remoteServerRouteId(row)),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setInstallDialog(null);
      void qc.invalidateQueries({ queryKey: ["provision-job"] });
      toast({
        title: "Docker purge queued",
        description: "Removal runs over SSH. Follow the log below.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not queue purge", description: e.message, variant: "destructive" }),
  });

  const traefikRedeployMut = useMutation({
    mutationFn: () => enqueueRemoteTraefikRedeployApi(accessToken, remoteServerRouteId(row)),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setInstallDialog(null);
      void qc.invalidateQueries({ queryKey: ["provision-job"] });
      toast({
        title: "Traefik redeploy queued",
        description: "Updating Traefik config over SSH. Watch the log below.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not queue Traefik redeploy", description: e.message, variant: "destructive" }),
  });

  const terminalOk = jobQ.data?.status === "done";
  const terminalErr = jobQ.data?.status === "error";

  return (
    <>
      <div className="min-w-0 border-t border-border bg-slate-100/90 dark:bg-muted/20 px-4 py-2.5 sm:px-5">
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p
            className="min-w-0 text-center text-[11px] text-muted-foreground sm:text-left sm:truncate"
            title={row.createdAt}
          >
            <span className="inline-flex items-center justify-center gap-1 sm:justify-start">
              <Clock className="w-3 h-3 shrink-0" />
              {formatCreatedAtLabel(row.createdAt)}
            </span>
          </p>
        <Popover
          open={installMaintenanceAllowed ? installMenuOpen : false}
          onOpenChange={(open) => {
            if (!installMaintenanceAllowed) return;
            setInstallMenuOpen(open);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!installMaintenanceAllowed}
              title={
                installMaintenanceAllowed
                  ? undefined
                  : "Install and maintenance scripts are disabled for your role in this organization"
              }
              className="inline-flex w-full sm:w-auto min-h-9 items-center justify-center gap-2 rounded-lg border border-border/80 bg-background/80 px-3 py-2 text-xs font-medium text-foreground shadow-sm hover:bg-muted/50 dark:bg-muted/30 dark:hover:bg-muted/45 disabled:pointer-events-none disabled:opacity-40"
            >
              Installs &amp; maintenance
              <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-x-hidden p-1.5"
            align="end"
            sideOffset={6}
          >
            <p className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Remote host scripts
            </p>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                className="rounded-md px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted/80 dark:hover:bg-muted/50"
                onClick={() => openInstallFlow("provision")}
              >
                <span className="font-medium">Server setup &amp; install</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                  Docker, Swarm, network, Traefik (deploy) or build host
                </span>
              </button>
              <button
                type="button"
                className="rounded-md px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted/80 dark:hover:bg-muted/50"
                onClick={() => openInstallFlow("nixpacks")}
              >
                <span className="font-medium">Nixpacks CLI only</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                  After setup — Dockerfile-less builds
                </span>
              </button>
              {row.serverRole === "deploy" ? (
                <button
                  type="button"
                  className="rounded-md px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted/80 dark:hover:bg-muted/50"
                  onClick={() => openInstallFlow("traefik_redeploy")}
                >
                  <span className="font-medium">Traefik redeploy</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    Apply certificate email &amp; config changes
                  </span>
                </button>
              ) : null}
              {showDockerPurgeOption ? (
                <button
                  type="button"
                  className="rounded-md px-2.5 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => openInstallFlow("purge")}
                >
                  <span className="font-medium">Remove Docker (purge)</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    Conflict cleanup — destructive
                  </span>
                </button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
        </div>
      </div>

      <Dialog
        open={installDialog !== null}
        onOpenChange={(open) => {
          if (!open) setInstallDialog(null);
        }}
      >
        <DialogContent className="max-h-[min(92vh,46rem)] max-w-[min(50rem,calc(100vw-2rem))] min-w-0 gap-5 overflow-x-hidden overflow-y-auto p-6 sm:rounded-xl sm:p-7">
          {installDialog === "provision" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Server setup &amp; install</DialogTitle>
                <DialogDescription className="text-left text-xs leading-relaxed">
                  {row.serverRole === "build" ? (
                    <>
                      Installs Docker if it is missing, starts it, and lets your SSH user run Docker — so this server
                      can build container images for you.
                    </>
                  ) : (
                    <>
                      When needed, it installs Docker and the Weehawk agents, switches on Swarm, creates a shared
                      network for your services, and opens the public web ports (80 and 443) so your deployments on this
                      server are reachable.
                    </>
                  )}{" "}
                  Nixpacks is not part of this script — use <strong className="text-foreground">Nixpacks CLI only</strong>{" "}
                  from the menu if you need it.
                </DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-3">
                {scriptQ.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading script…
                  </div>
                )}
                {scriptQ.isError && <p className="text-xs text-red-400">{(scriptQ.error as Error).message}</p>}
                {scriptQ.data?.script ? (
                  <pre className={scriptPreviewPreClassName}>{scriptQ.data.script}</pre>
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
            </>
          ) : null}

          {installDialog === "nixpacks" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Nixpacks CLI only</DialogTitle>
                <DialogDescription className="text-left text-xs leading-relaxed">
                  If this host is already provisioned, run this shorter script. It does not reinstall Docker, Swarm, or
                  Traefik — only installs or verifies the Nixpacks CLI.
                </DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-3">
                {nixOnlyScriptQ.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading script…
                  </div>
                )}
                {nixOnlyScriptQ.isError && (
                  <p className="text-xs text-red-400">{(nixOnlyScriptQ.error as Error).message}</p>
                )}
                {nixOnlyScriptQ.data?.script ? (
                  <pre className={scriptPreviewPreClassName}>{nixOnlyScriptQ.data.script}</pre>
                ) : null}
                <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-border"
                    checked={nixAck}
                    onChange={(e) => setNixAck(e.target.checked)}
                  />
                  <span>
                    Run this Nixpacks-only script on <strong className="text-foreground">{row.host}</strong> now.
                  </span>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    disabled={!row.hasPrivateKey || !nixAck || nixpacksOnlyMut.isPending}
                    onClick={() => nixpacksOnlyMut.mutate()}
                    className="btn-secondary inline-flex min-h-10 w-full items-center justify-center gap-1.5 text-xs disabled:pointer-events-none disabled:opacity-40 sm:min-h-0 sm:w-auto"
                  >
                    {nixpacksOnlyMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Install Nixpacks only
                  </button>
                  {!row.hasPrivateKey ? (
                    <span className="text-[11px] text-amber-500/85">Save a private key for this host first.</span>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {installDialog === "traefik_redeploy" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Traefik redeploy</DialogTitle>
                <DialogDescription className="text-left text-xs leading-relaxed">
                  Rewrites the Traefik static config (certificate email, entrypoints) and redeploys the Traefik
                  stack on this server. Does <strong className="text-foreground">not</strong> reinstall Docker, Swarm, or
                  the overlay network.
                </DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-3">
                {traefikRedeployScriptQ.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading script…
                  </div>
                )}
                {traefikRedeployScriptQ.isError && (
                  <p className="text-xs text-red-400">{(traefikRedeployScriptQ.error as Error).message}</p>
                )}
                {traefikRedeployScriptQ.data?.script ? (
                  <pre className={scriptPreviewPreClassName}>{traefikRedeployScriptQ.data.script}</pre>
                ) : null}
                <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-border"
                    checked={traefikAck}
                    onChange={(e) => setTraefikAck(e.target.checked)}
                  />
                  <span>
                    Redeploy Traefik config on <strong className="text-foreground">{row.host}</strong> now.
                  </span>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    disabled={!row.hasPrivateKey || !traefikAck || traefikRedeployMut.isPending}
                    onClick={() => traefikRedeployMut.mutate()}
                    className="btn-secondary inline-flex min-h-10 w-full items-center justify-center gap-1.5 text-xs disabled:pointer-events-none disabled:opacity-40 sm:min-h-0 sm:w-auto"
                  >
                    {traefikRedeployMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Redeploy Traefik
                  </button>
                  {!row.hasPrivateKey ? (
                    <span className="text-[11px] text-amber-500/85">Save a private key for this host first.</span>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {installDialog === "purge" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base text-destructive">Remove Docker (purge)</DialogTitle>
                <DialogDescription asChild>
                  <div className="text-left text-[11px] text-red-400/90 leading-relaxed border border-red-500/25 rounded-lg bg-red-500/5 p-2.5">
                    <strong className="text-red-300">Danger:</strong> removes Docker and all images and containers on
                    this server. Use only if Docker is broken. Then run <strong className="text-red-200">Server setup &amp; install</strong>{" "}
                    from Installs &amp; maintenance for a fresh setup. Needs admin (sudo) access.
                  </div>
                </DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-3">
                {purgeScriptQ.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading script…
                  </div>
                )}
                {purgeScriptQ.isError && <p className="text-xs text-red-400">{(purgeScriptQ.error as Error).message}</p>}
                {purgeScriptQ.data?.script ? (
                  <pre className={scriptPreviewPreClassName}>{purgeScriptQ.data.script}</pre>
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
                    <strong className="text-foreground">{row.host}</strong> and I want the platform to run the purge
                    script now.
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
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {jobId && jobQ.data && !jobLogDismissed ? (
        <div className="min-w-0 border-t border-border bg-slate-100/80 px-4 py-3 dark:bg-muted/10 sm:px-5">
          <div className="min-w-0 rounded-lg border border-slate-300 bg-slate-100 p-3 space-y-2 shadow-inner dark:border-border dark:bg-black/40">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <p className="text-[11px] font-medium min-w-0 text-slate-800 dark:text-zinc-100">
                Job ({provisionJobKindLabel(jobQ.data.jobKind)}):{" "}
                <span className="font-mono text-[10px] text-slate-500 dark:text-zinc-400">{jobId.slice(0, 8)}…</span>
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
                  className="rounded-md p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-200 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/10"
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
              <pre
                ref={jobLogPreRef}
                onScroll={(e) => {
                  const t = e.currentTarget;
                  const nearBottom =
                    t.scrollHeight - t.scrollTop - t.clientHeight <= 80;
                  jobLogUserScrolledAwayRef.current = !nearBottom;
                }}
                className="min-w-0 max-w-full text-[10px] font-mono whitespace-pre-wrap break-words max-h-56 overflow-x-hidden overflow-y-auto text-slate-700 dark:text-zinc-300 leading-snug"
              >
                {jobQ.data.log}
              </pre>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">Waiting for log output…</p>
            )}
          </div>
        </div>
      ) : null}

      {jobId && jobQ.data && jobLogDismissed ? (
        <div className="border-t border-border bg-slate-100/80 px-4 py-2 dark:bg-muted/10 sm:px-5">
          <button
            type="button"
            onClick={() => setJobLogDismissed(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Show job log ({provisionJobKindLabel(jobQ.data.jobKind)} · {jobQ.data.status})
          </button>
        </div>
      ) : null}
    </>
  );
}
