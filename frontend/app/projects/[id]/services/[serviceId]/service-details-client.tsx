"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { format, formatDistanceToNow } from "date-fns";
import {
  Container, Layers, Copy, Trash2, FileCode,
  Info, Hash, FolderKanban, CheckCircle, XCircle,
  Download, Edit3, Save, X, Calendar, Tag, Plus,
  Terminal, Rocket, RefreshCw, Square, Play, RotateCw, Activity, Loader2,
  Shield, Variable, Globe, ExternalLink, Link2, ScrollText, HardDrive,
} from "lucide-react";
import {
  useService,
  useDeleteService,
  useShutdownService,
  useStartService,
  useServiceRuntime,
  useUpdateService,
} from "@/hooks/use-services";
import { useProject } from "@/hooks/use-projects";
import { useDockerSecretsPagedWithInitialData } from "@/hooks/use-docker-secrets";
import { useDeploy } from "@/hooks/use-deploy-logs";
import { AppLayout } from "@/components/layout/AppLayout";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import type { Project, Service } from "@/lib/schema";
import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import { streamServiceLogs } from "@/lib/services-api";
import { ServiceTerminalPanel } from "./service-terminal-panel";
import { ServiceSecretsTab } from "./service-secrets-tab";
import { ServiceVolumesTab } from "./service-volumes-tab";
const MAX_LIVE_LOG_CHARS = 512 * 1024;

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVICE_TYPE_CONFIG = {
  "docker-compose": {
    label: "Docker Compose",
    color: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
    glow: "shadow-[0_0_24px_rgba(255,255,255,0.06)]",
    icon: Container,
    placeholder: `version: '3.8'

services:
  app:
    image: nginx:latest
    container_name: my-app
    ports:
      - "80:80"
      - "443:443"
    environment:
      - NODE_ENV=production
      - PORT=80
    volumes:
      - ./data:/data
      - ./logs:/var/log/nginx
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  app-network:
    driver: bridge`,
  },
  stack: {
    label: "Stack",
    color: "bg-white/5 text-zinc-200 border-white/10",
    glow: "shadow-[0_0_24px_rgba(255,255,255,0.05)]",
    icon: Layers,
    placeholder: `version: '3.8'

services:
  app:
    image: nginx:latest
    ports:
      - "80:80"
    networks:
      - overlay-net
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      rollback_config:
        parallelism: 1
        delay: 5s
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: '0.50'
          memory: 512M

networks:
  overlay-net:
    driver: overlay`,
  },
};

type Tab = "overview" | "config" | "env" | "volumes" | "domain" | "secrets" | "logs" | "terminal";

// ─── YAML colorizer ───────────────────────────────────────────────────────────

function colorizeYaml(line: string) {
  if (/^\s*#/.test(line)) return <span className="text-zinc-500 italic">{line}</span>;
  const [main, ...rest] = line.split(/#/);
  const comment = rest.length ? `#${rest.join("#")}` : "";
  const keyMatch = main.match(/^(\s*)([^:\s][^:]*?)(\s*:\s*)(.*)/);
  if (keyMatch) {
    const [, indent, key, colon, value] = keyMatch;
    return (
      <>
        <span>{indent}</span>
        <span className="text-zinc-300">{key}</span>
        <span className="text-zinc-500">{colon}</span>
        {value && renderYamlValue(value)}
        {comment && <span className="text-zinc-600 italic"> {comment}</span>}
      </>
    );
  }
  if (/^\s*-\s/.test(line)) {
    return <span className="text-zinc-300">{line}</span>;
  }
  return <span className="text-zinc-400">{line}</span>;
}

function renderYamlValue(v: string) {
  const t = v.trim();
  if (t.startsWith("'") || t.startsWith('"')) return <span className="text-amber-300">{v}</span>;
  if (/^-?\d+(\.\d+)?$/.test(t)) return <span className="text-emerald-300">{v}</span>;
  if (["true", "false", "null", "yes", "no"].includes(t)) return <span className="text-orange-300">{v}</span>;
  return <span className="text-zinc-200">{v}</span>;
}

/** Non-empty, non-comment lines that look like KEY=value (used for tab badge / overview). */
function countEnvEntries(text: string) {
  return text.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#") && t.includes("=");
  }).length;
}

// ─── Main Component ───────────────────────────────────────────────────────────

type ServiceDetailsProps = {
  initialService?: Service | null;
  initialProject?: Project | null;
  initialRuntime?: { running: boolean } | null;
  initialSecretsPaged?: PaginatedSecretsResponse | null;
};

export default function ServiceDetails({
  initialService,
  initialProject,
  initialRuntime,
  initialSecretsPaged,
}: ServiceDetailsProps) {
  const { id: projectId, serviceId } = useParams<{ id: string; serviceId: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [editingConfig, setEditingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState("");
  const [liveLogText, setLiveLogText] = useState("");
  const [liveLogError, setLiveLogError] = useState<string | null>(null);
  /** True until the first SSE chunk for this connection (spinner); Clear does not reset this. */
  const [liveLogAwaitingFirstChunk, setLiveLogAwaitingFirstChunk] = useState(true);
  const liveLogScrollRef = useRef<HTMLDivElement>(null);

  const { data: service, isLoading } = useService(serviceId!, {
    initialData: initialService ?? undefined,
  });
  const { data: runtime, isLoading: runtimeLoading } = useServiceRuntime(serviceId, {
    initialData: initialRuntime ?? undefined,
  });
  const { data: project } = useProject(projectId!, {
    initialData: initialProject ?? undefined,
  });
  const { data: secretsPaged } = useDockerSecretsPagedWithInitialData(1, "", {
    initialData: initialSecretsPaged ?? undefined,
  });
  const deleteService = useDeleteService();
  const shutdownService = useShutdownService();
  const startService = useStartService();
  const updateService = useUpdateService();
  const deploy = useDeploy();
  const { toast } = useToast();
  const confirm = useConfirm();

  const envEntryCount = countEnvEntries(service?.env ?? "");
  const typeConf = service ? (SERVICE_TYPE_CONFIG[service.type] ?? SERVICE_TYPE_CONFIG["docker-compose"]) : SERVICE_TYPE_CONFIG["docker-compose"];

  const runningOnHost = runtime?.running ?? false;
  const actionBusy = deploy.isPending || startService.isPending || shutdownService.isPending;

  useEffect(() => {
    if (activeTab !== "logs" || !serviceId) return;
    const ac = new AbortController();

    // Reset UI state on tab switch asynchronously to avoid cascading renders.
    queueMicrotask(() => {
      setLiveLogError(null);
      setLiveLogText("");
      setLiveLogAwaitingFirstChunk(true);
    });

    void streamServiceLogs(
      serviceId,
      (chunk) => {
        setLiveLogAwaitingFirstChunk(false);
        setLiveLogText((prev) => {
          const next = prev + chunk;
          return next.length > MAX_LIVE_LOG_CHARS ? next.slice(-MAX_LIVE_LOG_CHARS) : next;
        });
      },
      (msg) => {
        setLiveLogError(msg);
        setLiveLogAwaitingFirstChunk(false);
      },
      ac.signal,
    );
    return () => ac.abort();
  }, [activeTab, serviceId]);

  useEffect(() => {
    if (activeTab !== "logs") return;
    const el = liveLogScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [liveLogText, activeTab]);

  // ── Config actions ──
  const handleSaveConfig = () => {
    if (!service) return;
    updateService.mutate(
      { id: service.id, patch: { config: configDraft } },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "Configuration updated." });
          setEditingConfig(false);
        },
        onError: (e: Error) =>
          toast({ title: "Could not save", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleDownload = () => {
    if (!service?.config) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([service.config], { type: "text/yaml" }));
    a.download = `${service.name}.yml`;
    a.click();
    toast({ title: "Downloaded", description: `${service.name}.yml saved.` });
  };

  // ── Deploy / Redeploy (Docker API) ──
  const handleRunDocker = (mode: "deploy" | "redeploy") => {
    if (!service) return;
    setActiveTab("logs");
    deploy.mutate(
      { serviceId: service.id, serviceName: service.name, serviceType: service.type, mode },
      {
        onSuccess: (log) => {
          if (log.status !== "success") return;
          toast({
            title: mode === "redeploy" ? "Redeploy finished" : "Deploy successful",
            description:
              mode === "redeploy"
                ? `${service.name} was restarted with a fresh build (Compose) or rolling restart (Stack).`
                : `${service.name} deployed.`,
          });
        },
      },
    );
  };

  const handleStartHost = () => {
    if (!service) return;
    startService.mutate(service.id, {
      onSuccess: (data) =>
        toast({
          title: "Started",
          description: typeof data?.output === "string" && data.output.trim()
            ? data.output.slice(0, 200)
            : "Containers are starting on the host.",
        }),
      onError: (e: Error) =>
        toast({ title: "Start failed", description: e.message, variant: "destructive" }),
    });
  };

  const handleStop = async () => {
    if (!service) return;
    const ok = await confirm({
      title: "Stop running workload?",
      description:
        `This stops Docker for “${service.name}” (compose stop or stack scale 0). Your service record, YAML, and .env stay saved — deploy again when ready.`,
      confirmLabel: "Stop",
      variant: "destructive",
    });
    if (!ok) return;
    shutdownService.mutate(service.id, {
      onSuccess: (data) =>
        toast({
          title: "Stopped",
          description: typeof data?.message === "string" ? data.message : "Containers stopped on the host.",
        }),
      onError: (e: Error) =>
        toast({ title: "Stop failed", description: e.message, variant: "destructive" }),
    });
  };

  const handleDelete = async () => {
    if (!service) return;
    const ok = await confirm({
      title: "Delete this service?",
      description: `“${service.name}” will be removed. Related containers or stacks on the host may be stopped.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    deleteService.mutate(service.id, {
      onSuccess: () => {
        toast({ title: "Service Deleted" });
        router.push(`/projects/${projectId}`);
      },
      onError: (e: Error) =>
        toast({ title: "Could not delete service", description: e.message, variant: "destructive" }),
    });
  };

  if (isLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    </AppLayout>
  );

  if (!service) return (
    <AppLayout>
      <div className="glass-panel rounded-2xl p-12 text-center">
        <p className="text-muted-foreground mb-4">Service not found.</p>
        <Link href={`/projects/${projectId}`}><button className="btn-secondary">Back to Project</button></Link>
      </div>
    </AppLayout>
  );

  const TypeIcon = typeConf.icon;

  const tabs: { id: Tab; label: string; icon: typeof Info; count?: number }[] = [
    { id: "overview", label: "Overview", icon: Info },
    { id: "config",   label: "Configuration", icon: FileCode },
    { id: "env",      label: "Environment", icon: Variable, count: envEntryCount || undefined },
    { id: "volumes",  label: "Volumes", icon: HardDrive },
    { id: "domain",   label: "Domains", icon: Globe, count: service.domains?.length },
    { id: "secrets",  label: "Secrets", icon: Shield, count: secretsPaged?.totalAll },
    { id: "logs",     label: "Logs", icon: ScrollText },
    { id: "terminal", label: "Terminal", icon: Terminal },
  ];

  return (
    <AppLayout>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
        <Link href="/projects">
          <span className="hover:text-foreground cursor-pointer flex items-center gap-1 transition-colors">
            <FolderKanban className="w-3.5 h-3.5" /> Projects
          </span>
        </Link>
        <span className="text-white/20">/</span>
        <Link href={`/projects/${projectId}`}>
          <span className="hover:text-foreground cursor-pointer transition-colors">{project?.name ?? "Project"}</span>
        </Link>
        <span className="text-white/20">/</span>
        <span className="text-foreground font-medium">{service.name}</span>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

        {/* ── Hero Header ── */}
        <div className={`glass-panel rounded-2xl p-6 relative overflow-hidden ${typeConf.glow}`}>
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[80px] pointer-events-none" />
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="flex items-center gap-5">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${typeConf.color} flex-shrink-0`}>
                <TypeIcon className="w-8 h-8" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap mb-1">
                  <h1 className="text-2xl font-bold tracking-tight">{service.name}</h1>
                  <span className={`text-xs border rounded-full px-2.5 py-1 font-semibold ${typeConf.color}`}>{typeConf.label}</span>
                  {runtimeLoading ? (
                    <span className="text-xs border rounded-full px-2.5 py-1 font-semibold text-zinc-500 border-zinc-500/20">
                      Checking Docker…
                    </span>
                  ) : (
                    <span
                      className={`text-xs border rounded-full px-2.5 py-1 font-semibold flex items-center gap-1.5 ${
                        runningOnHost
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                          : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                      }`}
                      title="From docker compose ps / stack services on the server"
                    >
                      {runningOnHost ? (
                        <><Activity className="w-3 h-3" />Running on host</>
                      ) : (
                        <><Square className="w-3 h-3" />Stopped on host</>
                      )}
                    </span>
                  )}
                </div>
                {service.description && <p className="text-muted-foreground text-sm">{service.description}</p>}
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  Created {format(new Date(service.createdAt), "MMMM d, yyyy 'at' HH:mm")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleRunDocker("deploy")}
                disabled={actionBusy}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deploy.isPending && deploy.variables?.mode === "deploy" ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" />Deploying…</>
                ) : (
                  <><Rocket className="w-4 h-4" />Deploy</>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleRunDocker("redeploy")}
                disabled={actionBusy}
                title="Compose: stop project then docker compose up -d --build. Stack: docker stack deploy then docker service update --force on each service."
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-muted text-foreground hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deploy.isPending && deploy.variables?.mode === "redeploy" ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" />Redeploying…</>
                ) : (
                  <><RotateCw className="w-4 h-4" />Redeploy</>
                )}
              </button>
              {runningOnHost ? (
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={actionBusy}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/40 bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {shutdownService.isPending ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />Stopping…</>
                  ) : (
                    <><Square className="w-4 h-4 fill-current" />Stop</>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartHost}
                  disabled={actionBusy}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {startService.isPending ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />Starting…</>
                  ) : (
                    <><Play className="w-4 h-4 fill-current" />Start</>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center justify-center p-2 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                title="Delete service"
                aria-label="Delete service"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 bg-card/50 rounded-xl border border-white/5 w-fit overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.div layoutId="tab-bg" className="absolute inset-0 bg-white/10 rounded-lg border border-white/10"
                    initial={false} transition={{ type: "spring", stiffness: 400, damping: 35 }} />
                )}
                <Icon className="w-4 h-4 relative z-10" />
                <span className="relative z-10">{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="relative z-10 bg-primary/20 text-primary text-xs rounded-full px-1.5 min-w-[1.25rem] text-center leading-tight py-0.5">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab Content ── */}
        <AnimatePresence mode="wait">

          {/* ── OVERVIEW ── */}
          {activeTab === "overview" && (
            <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoCard icon={<Hash className="w-4 h-4 text-primary" />} label="Service ID" value={service.id} mono copyable
                onCopy={() => { navigator.clipboard.writeText(service.id); toast({ title: "Copied", description: "Service ID copied." }); }} />
              <InfoCard icon={<TypeIcon className="w-4 h-4 text-primary" />} label="Service Type" value={typeConf.label} badge={typeConf.color} />
              <InfoCard icon={<FolderKanban className="w-4 h-4 text-primary" />} label="Project" value={project?.name ?? "—"} link={`/projects/${projectId}`} />
              <InfoCard
                icon={
                  runtimeLoading ? (
                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                  ) : runningOnHost ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-zinc-400" />
                  )
                }
                label="Status"
                value={runtimeLoading ? "Checking Docker…" : runningOnHost ? "Running" : "Stopped"}
                badge={
                  runtimeLoading
                    ? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                    : runningOnHost
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                }
              />
              <InfoCard icon={<Calendar className="w-4 h-4 text-primary" />} label="Created At"
                value={format(new Date(service.createdAt), "MMMM d, yyyy 'at' HH:mm")} />
              <InfoCard
                icon={<Rocket className="w-4 h-4 text-primary" />}
                label="Docker on host"
                value={
                  runtimeLoading
                    ? "Checking…"
                    : `${runningOnHost ? "Running" : "Stopped"} · ${
                        service.lastDeployedAt
                          ? `last deploy ${formatDistanceToNow(new Date(service.lastDeployedAt), { addSuffix: true })}`
                          : "never deployed"
                      }`
                }
              />
              <InfoCard icon={<Tag className="w-4 h-4 text-primary" />} label="Configuration"
                value={service.config ? `${service.config.split("\n").length} lines` : "Not configured"} />
              <InfoCard icon={<Variable className="w-4 h-4 text-primary" />} label="Environment (.env)"
                value={envEntryCount > 0 ? `${envEntryCount} variable${envEntryCount !== 1 ? "s" : ""}` : "Not set"} />
            </motion.div>
          )}

          {/* ── CONFIGURATION ── */}
          {activeTab === "config" && (
            <motion.div key="config" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="glass-panel rounded-2xl overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">{service.name}.yml</span>
                  <span className={`text-xs border rounded-full px-2 py-0.5 ${typeConf.color}`}>{typeConf.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {editingConfig ? (
                    <>
                      <button onClick={() => setEditingConfig(false)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/5 transition-colors">
                        <X className="w-3.5 h-3.5" />Cancel
                      </button>
                      <button onClick={handleSaveConfig}
                        className="flex items-center gap-1.5 text-xs text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors">
                        <Save className="w-3.5 h-3.5" />Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setConfigDraft(service.config || ""); setEditingConfig(true); }}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/5 transition-colors">
                        <Edit3 className="w-3.5 h-3.5" />Edit
                      </button>
                      {service.config && <>
                        <button onClick={() => { navigator.clipboard.writeText(service.config); toast({ title: "Copied!" }); }}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/5 transition-colors">
                          <Copy className="w-3.5 h-3.5" />Copy
                        </button>
                        <button onClick={handleDownload}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/5 transition-colors">
                          <Download className="w-3.5 h-3.5" />Download
                        </button>
                      </>}
                    </>
                  )}
                </div>
              </div>

              {editingConfig ? (
                <textarea
                  value={configDraft}
                  onChange={(e) => setConfigDraft(e.target.value)}
                  placeholder={typeConf.placeholder}
                  className="w-full bg-black/70 text-emerald-200 font-mono text-xs p-5 min-h-[420px] resize-y outline-none border-none leading-relaxed placeholder:text-zinc-700"
                  spellCheck={false}
                />
              ) : service.config ? (
                <div className="bg-black/70 overflow-x-auto">
                  <table className="w-full border-collapse text-xs font-mono leading-relaxed">
                    <tbody>
                      {service.config.split("\n").map((line, i) => (
                        <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                          <td className="select-none text-right pr-4 pl-4 py-0.5 text-zinc-600 border-r border-white/5 min-w-[3rem] w-10">{i + 1}</td>
                          <td className="pl-5 pr-5 py-0.5 whitespace-pre">{colorizeYaml(line)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-black/50 p-12 text-center">
                  <FileCode className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                  <p className="text-muted-foreground text-sm mb-1 font-medium">No configuration yet</p>
                  <p className="text-muted-foreground/60 text-xs mb-5 max-w-sm mx-auto">
                    Add your {typeConf.label} YAML configuration to get started.
                  </p>
                  <button onClick={() => { setConfigDraft(""); setEditingConfig(true); }}
                    className="btn-primary text-sm flex items-center gap-2 mx-auto">
                    <Edit3 className="w-4 h-4" />Add Configuration
                  </button>
                  {/* Show placeholder hint */}
                  <div className="mt-6 text-left max-w-lg mx-auto">
                    <p className="text-xs text-zinc-600 mb-2 font-mono">Example template for {typeConf.label}:</p>
                    <pre className="text-xs font-mono text-zinc-700 leading-relaxed overflow-x-auto">
                      {typeConf.placeholder.split("\n").slice(0, 8).join("\n")}
                      {"\n..."}
                    </pre>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ── ENVIRONMENT VARIABLES ── */}
          {activeTab === "env" && (
            <motion.div key="env" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="space-y-4">
              <EnvFilePanel service={service} />
            </motion.div>
          )}

          {activeTab === "volumes" && (
            <motion.div key="volumes" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="space-y-4">
              <ServiceVolumesTab serviceId={service.id} enabled={activeTab === "volumes"} />
            </motion.div>
          )}

          {/* ── DOMAIN ── */}
          {activeTab === "domain" && (
            <motion.div key="domain" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}>
              <DomainsPanel service={service} />
            </motion.div>
          )}

          {/* ── SECRETS ── */}
          {activeTab === "secrets" && (
            <motion.div key="secrets" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="space-y-4">
              <ServiceSecretsTab />
            </motion.div>
          )}

          {/* ── LOGS ── */}
          {activeTab === "logs" && (
            <motion.div key="logs" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}>
              <div className="glass-panel rounded-xl overflow-hidden flex flex-col border border-border/60 min-h-[min(70vh,560px)] max-h-[min(88vh,760px)]">
                <div className="px-5 pt-5 pb-3 border-b border-border/60 shrink-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ScrollText className="w-5 h-5 text-primary shrink-0" />
                        <h2 className="text-base font-semibold tracking-tight">Logs</h2>
                        {service && (
                          <span className="font-mono text-sm font-normal text-muted-foreground truncate max-w-[min(100%,28rem)]">
                            {service.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                        Live stream from{" "}
                        <code className="text-[11px] bg-muted px-1 rounded">docker compose logs -f</code> /{" "}
                        <code className="text-[11px] bg-muted px-1 rounded">docker service logs -f</code> on the server host.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("terminal")}
                      className="btn-secondary inline-flex items-center gap-2 text-sm py-2 px-3 shrink-0 self-start"
                    >
                      <Terminal className="w-4 h-4" />
                      Terminal
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 px-5 py-2 border-b border-border/40 bg-muted/20 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setLiveLogText("")}
                    className="btn-secondary text-xs py-1.5 h-8 flex items-center gap-1.5"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(liveLogText);
                      toast({ title: "Copied", description: "Logs copied to clipboard." });
                    }}
                    className="btn-secondary text-xs py-1.5 h-8 flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>

                <div
                  ref={liveLogScrollRef}
                  className="flex-1 min-h-[200px] overflow-auto px-5 py-4 bg-zinc-950/80"
                >
                  {liveLogError ? (
                    <div className="text-sm text-destructive whitespace-pre-wrap">{liveLogError}</div>
                  ) : liveLogAwaitingFirstChunk && !liveLogText ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <p className="text-sm">Waiting for log lines…</p>
                    </div>
                  ) : (
                    <pre className="text-xs font-mono text-zinc-200 whitespace-pre-wrap break-all leading-relaxed min-h-[4rem]">
                      {liveLogText}
                    </pre>
                  )}
                </div>

                <div className="px-5 py-3 border-t border-border/60 shrink-0">
                  <p className="text-[11px] text-muted-foreground">
                    Timestamps come from Docker when available. Clear only clears the view; new lines keep streaming. The stream stops when you leave this tab.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "terminal" && (
            <motion.div
              key="terminal"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ServiceTerminalPanel serviceId={service.id} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

    </AppLayout>
  );
}

// ─── InfoCard ─────────────────────────────────────────────────────────────────

function InfoCard({ icon, label, value, mono = false, copyable = false, onCopy, badge, link }:
  { icon: React.ReactNode; label: string; value: string; mono?: boolean; copyable?: boolean; onCopy?: () => void; badge?: string; link?: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="glass-panel rounded-xl p-5 group">
      <div className="flex items-center gap-2 mb-2.5">
        {icon}
        <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {badge ? (
          <span className={`text-xs border rounded-full px-2.5 py-1 font-semibold ${badge}`}>{value}</span>
        ) : link ? (
          <Link href={link}>
            <span className={`font-medium text-sm text-primary hover:underline cursor-pointer ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</span>
          </Link>
        ) : (
          <span className={`font-medium text-sm text-foreground ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</span>
        )}
        {copyable && onCopy && (
          <button onClick={onCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground flex-shrink-0">
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── EnvFilePanel (server.env → ExecutorService.parseEnv on deploy) ─────────

function EnvFilePanel({ service }: { service: Service }) {
  const updateService = useUpdateService();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const envText = service.env ?? "";
  const entries = countEnvEntries(editing ? draft : envText);

  const handleSave = () => {
    updateService.mutate(
      { id: service.id, patch: { env: draft } },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "ENV file is stored on the server and used when you deploy." });
          setEditing(false);
        },
        onError: (e: Error) =>
          toast({ title: "Could not save", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-5 py-3.5 border-b border-white/5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Variable className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold">Environment file</span>
            <span className="text-xs text-muted-foreground">
              {entries > 0 ? `${entries} variable${entries !== 1 ? "s" : ""}` : "Empty"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-xl leading-relaxed">
            Same format as a <code className="text-foreground/80">.env</code> file. Lines starting with{" "}
            <code className="text-foreground/80">#</code> are comments. On deploy, these are merged into the environment for{" "}
            <code className="text-foreground/80">docker compose</code> / <code className="text-foreground/80">docker stack deploy</code> on the server.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateService.isPending}
                className="flex items-center gap-1.5 text-xs text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors disabled:opacity-50"
              >
                {updateService.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(envText);
                  toast({ title: "Copied", description: ".env copied to clipboard." });
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/5 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(envText);
                  setEditing(true);
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/5 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'NODE_ENV=production\nPORT=3000\n# optional comment'}
          className="w-full bg-black/70 text-zinc-200 font-mono text-xs p-5 min-h-[320px] resize-y outline-none border-none leading-relaxed placeholder:text-zinc-700"
          spellCheck={false}
        />
      ) : (
        <pre className="w-full bg-black/70 text-zinc-300 font-mono text-xs p-5 min-h-[200px] min-w-0 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
          {envText.trim() ? (
            envText
          ) : (
            <span className="text-zinc-600 italic">No environment variables. Click Edit to add a .env file.</span>
          )}
        </pre>
      )}
    </div>
  );
}

// ─── DomainsPanel ─────────────────────────────────────────────────────────────

function DomainsPanel({ service }: { service: import("@/lib/schema").Service }) {
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();
  const updateService = useUpdateService();

  const saveDomains = (domains: string[]) => {
    updateService.mutate(
      { id: service.id, patch: { domains } },
      {
        onError: (e: Error) =>
          toast({ title: "Error", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleAdd = () => {
    const raw = newDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!raw) return;
    if ((service.domains ?? []).includes(raw)) {
      toast({ title: "Already added", description: raw }); return;
    }
    const updated = [...(service.domains ?? []), raw];
    saveDomains(updated);
    setNewDomain("");
    setAdding(false);
    toast({ title: "Domain Added", description: raw });
  };

  const handleRemove = (domain: string) => {
    const updated = (service.domains ?? []).filter((d) => d !== domain);
    saveDomains(updated);
    toast({ title: "Domain Removed" });
  };

  const domains = service.domains ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {domains.length} domain{domains.length !== 1 ? "s" : ""} linked to this service
        </p>
        <button onClick={() => setAdding(!adding)}
          className="flex items-center gap-1.5 text-sm text-primary hover:underline">
          <Plus className="w-3.5 h-3.5" />Add Domain
        </button>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />Add Domain
            </h4>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  className="input-field pl-9 w-full font-mono text-sm"
                  placeholder="example.com or api.example.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
              </div>
              <button onClick={() => { setAdding(false); setNewDomain(""); }} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleAdd} disabled={!newDomain.trim()} className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />Add
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Enter the domain without <span className="font-mono">https://</span> — it will be added automatically.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {domains.length === 0 && !adding ? (
        <div className="glass-panel rounded-2xl p-12 flex flex-col items-center text-center">
          <div className="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center mb-4">
            <Globe className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No domains linked</h3>
          <p className="text-muted-foreground text-sm mb-5 max-w-sm">
            Add custom domains to route traffic to this service.
          </p>
          <button onClick={() => setAdding(true)} className="btn-primary text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />Add Domain
          </button>
        </div>
      ) : domains.length > 0 && (
        <div className="space-y-2">
          {domains.map((domain, i) => (
            <motion.div key={domain} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="glass-panel rounded-xl px-5 py-4 flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-mono text-sm font-medium">{domain}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1">
                      https://{domain} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { navigator.clipboard.writeText(`https://${domain}`); toast({ title: "Copied" }); }}
                  className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy URL"
                ><Copy className="w-3.5 h-3.5" /></button>
                <button
                  onClick={() => handleRemove(domain)}
                  className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove"
                ><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
