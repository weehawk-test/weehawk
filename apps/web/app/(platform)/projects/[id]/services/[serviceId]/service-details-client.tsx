"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Container, Layers, Copy, Trash2, FileCode,
  Info, Hash, FolderKanban, CheckCircle, XCircle,
  Download, Edit3, Save, X, Calendar, Tag, Plus,
  Terminal, Rocket, RefreshCw, Square, Play, RotateCw, Activity, Loader2,
  Shield, Variable, Globe, ExternalLink, Link2, ScrollText, Archive, ChevronDown,
  Database, Eye, EyeOff, Lock,
  LockOpen,
  PackageOpen,
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
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import type { Project, Service } from "@/lib/schema";
import {
  databaseLogoBlendClass,
  parseDatabaseEngineFromConfig,
  getDatabaseEngineById,
  defaultDatabaseImage,
  defaultDatabaseVolumePath,
  type DatabaseEngineId,
} from "@/lib/database-engines";
import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import { useQueryClient } from "@tanstack/react-query";
import {
  applyDatabaseApi,
  streamServiceLogs,
  updateDatabaseStackApi,
  uploadApplicationArchiveApi,
} from "@/lib/services-api";
import {
  parseApplicationBuildPath,
  parseApplicationNetworkHeaders,
  parseApplicationStoreHeaders,
  parseServiceEnvLines,
  parseYamlImage,
  parseYamlPublishPort,
  parseYamlReplicas,
} from "@/lib/env-utils";
import { ApplicationConnectionsPanel } from "./application-connections-panel";
import { ServiceTerminalPanel } from "./service-terminal-panel";
import { ServiceSecretsTab } from "./service-secrets-tab";
const MAX_LIVE_LOG_CHARS = 512 * 1024;

/** Deterministic on server + client (avoids hydration mismatch from `format()` using local TZ). */
function formatServiceDateUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

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
  application: {
    label: "Application",
    color: "bg-violet-500/10 text-violet-200 border-violet-500/25",
    glow: "shadow-[0_0_24px_rgba(139,92,246,0.10)]",
    icon: PackageOpen,
    placeholder: "",
  },
  databases: {
    label: "Databases",
    color: "bg-sky-500/10 text-sky-200 border-sky-500/25",
    glow: "shadow-[0_0_24px_rgba(56,189,248,0.08)]",
    icon: Database,
    placeholder: "",
  },
};

type Tab =
  | "overview"
  | "config"
  | "appconf"
  | "env"
  | "backup"
  | "domain"
  | "secrets"
  | "logs"
  | "terminal";

/** Hidden for database services until stack YAML exists (Postgres form saved). */
const DATABASE_PRECOMPOSE_HIDDEN: Tab[] = ["config", "backup", "terminal"];

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
  const typeConf = service ? (SERVICE_TYPE_CONFIG[service.type as keyof typeof SERVICE_TYPE_CONFIG] ?? SERVICE_TYPE_CONFIG["docker-compose"]) : SERVICE_TYPE_CONFIG["docker-compose"];
  const isDatabaseService = service?.type === "databases";
  const isApplicationService = service?.type === "application";
  const hasDatabaseCompose = Boolean(service?.config?.includes("services:"));

  const runningOnHost = runtime?.running ?? false;
  const actionBusy = deploy.isPending || startService.isPending || shutdownService.isPending;

  const tabs = useMemo(() => {
    type TabDef = { id: Tab; label: string; icon: typeof Info; count?: number };
    const head: TabDef[] = [
      { id: "overview", label: "Overview", icon: Info },
      { id: "config", label: "Configuration", icon: FileCode },
    ];
    const appConf: TabDef = { id: "appconf", label: "Application conf", icon: PackageOpen };
    const tail: TabDef[] = [
      { id: "env", label: "Environment", icon: Variable, count: envEntryCount || undefined },
      { id: "backup", label: "Backup", icon: Archive },
      { id: "domain", label: "Domains", icon: Globe, count: service?.domains?.length },
      { id: "secrets", label: "Secrets", icon: Shield, count: secretsPaged?.totalAll },
      { id: "logs", label: "Logs", icon: ScrollText },
      { id: "terminal", label: "Terminal", icon: Terminal },
    ];
    const allTabs: TabDef[] = isApplicationService ? [...head, appConf, ...tail] : [...head, ...tail];
    if (!isDatabaseService) return allTabs;
    const withoutDomainSecrets = allTabs.filter((t) => t.id !== "domain" && t.id !== "secrets");
    if (!hasDatabaseCompose) {
      return withoutDomainSecrets.filter((t) => !DATABASE_PRECOMPOSE_HIDDEN.includes(t.id));
    }
    return withoutDomainSecrets;
  }, [
    isDatabaseService,
    isApplicationService,
    hasDatabaseCompose,
    envEntryCount,
    service?.domains?.length,
    secretsPaged?.totalAll,
  ]);

  useEffect(() => {
    const allowed = new Set(tabs.map((t) => t.id));
    if (!allowed.has(activeTab)) setActiveTab("overview");
  }, [tabs, activeTab]);

  useEffect(() => {
    if ((isDatabaseService && !service?.config?.includes("services:")) || activeTab !== "logs" || !serviceId) return;
    const ac = new AbortController();
    let cancelled = false;

    setLiveLogError(null);
    setLiveLogText("");
    setLiveLogAwaitingFirstChunk(true);

    void streamServiceLogs(
      serviceId,
      (chunk) => {
        if (cancelled) return;
        setLiveLogAwaitingFirstChunk(false);
        setLiveLogText((prev) => {
          const next = prev + chunk;
          return next.length > MAX_LIVE_LOG_CHARS ? next.slice(-MAX_LIVE_LOG_CHARS) : next;
        });
      },
      (msg) => {
        if (cancelled) return;
        setLiveLogError(msg);
        setLiveLogAwaitingFirstChunk(false);
      },
      ac.signal,
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [activeTab, serviceId, isDatabaseService, service?.config]);

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
    if (service.type === "databases" && !service.config?.includes("services:")) {
      toast({
        title: "Configure Postgres first",
        description: "Fill the Postgres form and save to generate the stack file, then deploy.",
      });
      return;
    }
    setActiveTab("logs");
    deploy.mutate(
      { serviceId: service.id, serviceName: service.name, serviceType: service.type, mode },
      {
        onSuccess: (log) => {
          if (log.status !== "success") return;
          const isDb = service.type === "databases";
          toast({
            title: mode === "redeploy" ? "Redeploy finished" : "Deploy successful",
            description: isDb
              ? mode === "redeploy"
                ? `${service.name}: stack updated (docker stack deploy + rolling service updates where applicable).`
                : `${service.name}: stack deployed on Swarm (docker stack deploy).`
              : mode === "redeploy"
                ? `${service.name} was restarted with a fresh build (Compose) or rolling restart (Stack).`
                : `${service.name} deployed.`,
          });
        },
      },
    );
  };

  const handleStartHost = () => {
    if (!service) return;
    if (service.type === "databases" && !service.config?.includes("services:")) return;
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
    if (service.type === "databases" && !service.config?.includes("services:")) {
      toast({ title: "Nothing to stop", description: "Generate and deploy the database stack first." });
      return;
    }
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
    <>
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    </>
  );

  if (!service) return (
    <>
      <div className="glass-panel rounded-2xl p-12 text-center">
        <p className="text-muted-foreground mb-4">Service not found.</p>
        <Link href={`/projects/${projectId}`}><button className="btn-secondary">Back to Project</button></Link>
      </div>
    </>
  );

  const TypeIcon = typeConf.icon;
  const dbEngineId = isDatabaseService ? parseDatabaseEngineFromConfig(service.config ?? "") : undefined;
  const dbEngineLogoSrc = dbEngineId ? getDatabaseEngineById(dbEngineId)?.logoSrc : undefined;

  return (
    <>
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
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden ${
                  dbEngineLogoSrc
                    ? "border border-sky-500/25 bg-transparent p-2"
                    : typeConf.color
                }`}
              >
                {dbEngineLogoSrc && dbEngineId ? (
                  <Image
                    src={dbEngineLogoSrc}
                    alt=""
                    width={56}
                    height={56}
                    className={`object-contain max-h-12 w-auto max-w-[3.5rem] ${databaseLogoBlendClass(dbEngineId)}`}
                    sizes="64px"
                  />
                ) : (
                  <TypeIcon className="w-8 h-8" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap mb-1">
                  <h1 className="text-2xl font-bold tracking-tight">{service.name}</h1>
                  <span className={`text-xs border rounded-full px-2.5 py-1 font-semibold ${typeConf.color}`}>{typeConf.label}</span>
                  {isDatabaseService ? (
                    <span
                      className="text-xs border rounded-full px-2.5 py-1 font-semibold flex items-center gap-1.5 bg-sky-500/10 text-sky-300 border-sky-500/25"
                      title={dbEngineId ? `Engine: ${getDatabaseEngineById(dbEngineId)?.name ?? dbEngineId}` : "Database service"}
                    >
                      <Database className="w-3 h-3" />
                      {dbEngineId ? (getDatabaseEngineById(dbEngineId)?.name ?? dbEngineId) : "Databases"}
                    </span>
                  ) : runtimeLoading ? (
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
                      title={isDatabaseService ? "From docker stack services on the Swarm manager" : "From docker compose ps / stack services on the server"}
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
                  Created {formatServiceDateUtc(service.createdAt)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!isDatabaseService || hasDatabaseCompose ? (
                <>
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
                    title={isDatabaseService ? "Stack: docker stack deploy then forced rolling restart on each Swarm service." : "Compose: stop project then docker compose up -d --build. Stack: docker stack deploy then docker service update --force on each service."}
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
                </>
              ) : (
                <p className="text-xs text-muted-foreground max-w-md leading-relaxed border border-sky-500/20 rounded-xl px-4 py-2.5 bg-sky-500/5">
                  Fill the <span className="text-foreground font-medium">Postgres</span> form in Overview to save the stack YAML, then use Deploy (<span className="font-mono text-[11px]">docker stack deploy</span>).
                </p>
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
              transition={{ duration: 0.2 }} className="space-y-4">
              {isDatabaseService && dbEngineId && (
                <DatabaseSetupPanel serviceId={service.id} service={service} engine={dbEngineId} />
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoCard icon={<Hash className="w-4 h-4 text-primary" />} label="Service ID" value={service.id} mono copyable
                onCopy={() => { navigator.clipboard.writeText(service.id); toast({ title: "Copied", description: "Service ID copied." }); }} />
              <InfoCard
                icon={
                  dbEngineLogoSrc && dbEngineId ? (
                    <span className="relative flex h-8 w-8 items-center justify-center shrink-0">
                      <Image
                        src={dbEngineLogoSrc}
                        alt=""
                        width={32}
                        height={32}
                        className={`object-contain max-h-8 w-auto max-w-[2rem] ${databaseLogoBlendClass(dbEngineId)}`}
                        sizes="32px"
                      />
                    </span>
                  ) : (
                    <TypeIcon className="w-4 h-4 text-primary" />
                  )
                }
                label="Service Type"
                value={dbEngineId ? `${typeConf.label} · ${getDatabaseEngineById(dbEngineId)?.name ?? dbEngineId}` : typeConf.label}
                badge={typeConf.color}
              />
              <InfoCard icon={<FolderKanban className="w-4 h-4 text-primary" />} label="Project" value={project?.name ?? "—"} link={`/projects/${projectId}`} />
              {!isDatabaseService && (
                <>
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
                    value={formatServiceDateUtc(service.createdAt)} />
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
                </>
              )}
              {isDatabaseService && (
                <InfoCard icon={<Calendar className="w-4 h-4 text-primary" />} label="Created At"
                  value={formatServiceDateUtc(service.createdAt)} />
              )}
              <InfoCard icon={<Tag className="w-4 h-4 text-primary" />} label="Configuration"
                value={
                  isDatabaseService
                    ? "Use engine cards above (YAML provisioning later)"
                    : service.config
                      ? `${service.config.split("\n").length} lines`
                      : "Not configured"
                }
              />
              <InfoCard icon={<Variable className="w-4 h-4 text-primary" />} label="Environment (.env)"
                value={envEntryCount > 0 ? `${envEntryCount} variable${envEntryCount !== 1 ? "s" : ""}` : "Not set"} />
              </div>
            </motion.div>
          )}

          {/* ── APPLICATION CONF (ZIP upload + build + connections + env for deploy) ── */}
          {activeTab === "appconf" && isApplicationService && projectId && (
            <motion.div
              key="appconf"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <ApplicationArchivePanel serviceId={service.id} projectId={projectId} service={service} />
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

          {activeTab === "backup" && (
            <motion.div key="backup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="space-y-4">
              <div className="glass-panel rounded-xl border border-border/60 p-10 md:p-14 text-center max-w-lg mx-auto">
                <Archive className="w-12 h-12 text-muted-foreground/80 mx-auto mb-4" />
                <h2 className="text-lg font-semibold tracking-tight mb-2">Backup</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Volume and snapshot backups will be available here in a future update.
                </p>
              </div>
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
                        {isDatabaseService ? (
                          <>
                            Live stream from{" "}
                            <code className="text-[11px] bg-muted px-1 rounded">docker service logs -f</code> on the Swarm manager (stack services).
                          </>
                        ) : (
                          <>
                            Live stream from{" "}
                            <code className="text-[11px] bg-muted px-1 rounded">docker compose logs -f</code> /{" "}
                            <code className="text-[11px] bg-muted px-1 rounded">docker service logs -f</code> on the server host.
                          </>
                        )}
                      </p>
                    </div>
                    {(!isDatabaseService || hasDatabaseCompose) && (
                      <button
                        type="button"
                        onClick={() => setActiveTab("terminal")}
                        className="btn-secondary inline-flex items-center gap-2 text-sm py-2 px-3 shrink-0 self-start"
                      >
                        <Terminal className="w-4 h-4" />
                        Terminal
                      </button>
                    )}
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
                  {isDatabaseService && !hasDatabaseCompose ? (
                    <p className="text-sm text-muted-foreground text-center py-16 px-4 leading-relaxed max-w-md mx-auto">
                      Save the Postgres stack in <span className="text-foreground font-medium">Overview</span>, then deploy. Live logs stream here once the Swarm stack is running.
                    </p>
                  ) : liveLogError ? (
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

    </>
  );
}

// ─── Database setup (overview cards + one-time legacy form) ──

function dbPortByEngine(engine: DatabaseEngineId): number {
  if (engine === "postgres") return 5432;
  if (engine === "mysql" || engine === "mariadb") return 3306;
  if (engine === "mongodb") return 27017;
  return 6379;
}

function dbEnvKeys(engine: DatabaseEngineId) {
  if (engine === "postgres") return { db: "POSTGRES_DB", user: "POSTGRES_USER", pass: "POSTGRES_PASSWORD" };
  if (engine === "mysql") return { db: "MYSQL_DATABASE", user: "MYSQL_USER", pass: "MYSQL_PASSWORD" };
  if (engine === "mariadb") return { db: "MARIADB_DATABASE", user: "MARIADB_USER", pass: "MARIADB_PASSWORD" };
  if (engine === "mongodb") return { db: "MONGO_INITDB_DATABASE", user: "MONGO_INITDB_ROOT_USERNAME", pass: "MONGO_INITDB_ROOT_PASSWORD" };
  return { db: "", user: "", pass: "REDIS_PASSWORD" };
}

function readStoreMode(config: string, key: string): "env" | "secret" | undefined {
  const re = new RegExp(`^\\s*#\\s*store\\.${key}:\\s*(env|secret)\\s*$`, "m");
  const m = config.match(re);
  if (!m?.[1]) return undefined;
  return m[1] as "env" | "secret";
}

function DatabaseSetupPanel({ service, engine }: { serviceId: string; service: Service; engine: DatabaseEngineId }) {
  return <DatabaseCredentialsReadOnly service={service} engine={engine} />;
}

function DatabaseCredentialsReadOnly({ service, engine }: { service: Service; engine: DatabaseEngineId }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const env = parseServiceEnvLines(service.env ?? "");
  const hasStack = Boolean(service.config?.includes("services:"));
  const replicas = parseYamlReplicas(service.config ?? "") ?? 1;
  const keys = dbEnvKeys(engine);
  const containerPort = dbPortByEngine(engine);
  const hostPort = parseYamlPublishPort(service.config ?? "", containerPort);
  const yamlImage = parseYamlImage(service.config ?? "") ?? defaultDatabaseImage(engine);
  const hasDbName = engine !== "redis";
  const hasUser = engine === "postgres" || engine === "mysql" || engine === "mariadb" || engine === "mongodb";
  const primaryPasswordLabel = engine === "mongodb" ? "Root password" : "Password";
  const userLabel = engine === "mongodb" ? "Root user" : "User";
  const rootPassKey =
    engine === "mysql" ? "MYSQL_ROOT_PASSWORD" : engine === "mariadb" ? "MARIADB_ROOT_PASSWORD" : null;
  const dbStoreMode = keys.db ? readStoreMode(service.config ?? "", keys.db) : undefined;
  const userStoreMode = keys.user ? readStoreMode(service.config ?? "", keys.user) : undefined;
  const passStoreMode = readStoreMode(service.config ?? "", keys.pass);
  const rootPassStoreMode = rootPassKey ? readStoreMode(service.config ?? "", rootPassKey) : undefined;
  const [showPassword, setShowPassword] = useState(false);
  const [editingHostPort, setEditingHostPort] = useState(false);
  const [portDraft, setPortDraft] = useState("");
  const [portSaving, setPortSaving] = useState(false);
  const [editingReplicas, setEditingReplicas] = useState(false);
  const [replicasDraft, setReplicasDraft] = useState("");
  const [replicasSaving, setReplicasSaving] = useState(false);

  useEffect(() => {
    if (!editingHostPort) {
      setPortDraft(hostPort != null ? String(hostPort) : "");
    }
  }, [service.config, hostPort, editingHostPort]);

  useEffect(() => {
    if (!editingReplicas) {
      setReplicasDraft(String(replicas));
    }
  }, [service.config, replicas, editingReplicas]);

  const saveHostPort = async () => {
    const t = portDraft.trim();
    if (t) {
      const n = parseInt(t, 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        toast({
          title: "Invalid port",
          description: "Use an integer from 1 to 65535, or leave empty to unpublish.",
          variant: "destructive",
        });
        return;
      }
    }
    setPortSaving(true);
    try {
      await updateDatabaseStackApi(service.id, engine, {
        publishPort: t === "" ? null : parseInt(t, 10),
      });
      await queryClient.invalidateQueries({ queryKey: ["service", service.id] });
      setEditingHostPort(false);
      toast({
        title: "Stack updated",
        description: "Redeploy the stack so Docker applies the new port mapping.",
      });
    } catch (e: unknown) {
      toast({
        title: "Could not update port",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPortSaving(false);
    }
  };

  const saveReplicas = async () => {
    const n = parseInt(replicasDraft.trim(), 10);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      toast({
        title: "Invalid replicas",
        description: "Use an integer from 1 to 10.",
        variant: "destructive",
      });
      return;
    }
    setReplicasSaving(true);
    try {
      await updateDatabaseStackApi(service.id, engine, { replicas: n });
      await queryClient.invalidateQueries({ queryKey: ["service", service.id] });
      setEditingReplicas(false);
      toast({
        title: "Stack updated",
        description: "Redeploy the stack so Swarm applies the new replica count.",
      });
    } catch (e: unknown) {
      toast({
        title: "Could not update replicas",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setReplicasSaving(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl border border-sky-500/20 p-6 md:p-8">
      <h3 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Database className="w-5 h-5 text-sky-400" />
        {getDatabaseEngineById(engine)?.name ?? "Database"}
        <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground border border-border rounded-full px-2 py-0.5">
          <Lock className="w-3 h-3" />
          Saved
        </span>
      </h3>
      <p className="text-sm text-muted-foreground mb-5 max-w-2xl leading-relaxed">
        Credentials can be stored in <span className="text-foreground font-medium">Environment</span> or{" "}
        <span className="text-foreground font-medium">Docker Secrets</span>. Secret values are not readable from this page. Edit{" "}
        <span className="text-foreground font-medium">replicas</span> or <span className="text-foreground font-medium">host port</span> below, then redeploy.
      </p>
      {!hasStack && (
        <p className="text-xs text-amber-400/90 mb-4">
          No stack YAML is saved yet for this service.
        </p>
      )}
      <p className="text-xs font-mono text-sky-300/90 mb-5">
        Docker image: <span className="text-foreground">{yamlImage}</span>
      </p>
      <dl className="grid gap-4 sm:grid-cols-2 max-w-2xl text-sm">
        {hasDbName && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground mb-1">Database name</dt>
            <dd className="font-mono text-foreground break-all">
              {keys.db && env[keys.db] ? env[keys.db] : dbStoreMode === "secret" ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs font-normal">
                  <Lock className="w-3.5 h-3.5" />
                  Not readable (Docker Secrets)
                </span>
              ) : "—"}
            </dd>
          </div>
        )}
        {hasUser && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground mb-1">{userLabel}</dt>
            <dd className="font-mono text-foreground break-all">
              {keys.user && env[keys.user] ? env[keys.user] : userStoreMode === "secret" ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs font-normal">
                  <Lock className="w-3.5 h-3.5" />
                  Not readable (Docker Secrets)
                </span>
              ) : "—"}
            </dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground mb-1">{primaryPasswordLabel}</dt>
          <dd className="flex items-center gap-2 flex-wrap">
            {showPassword ? (
              env[keys.pass] ? (
                <span className="font-mono text-foreground break-all">{env[keys.pass]}</span>
              ) : passStoreMode === "secret" ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Lock className="w-3.5 h-3.5" />
                  Not readable (Docker Secrets)
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            ) : (
              <span className="font-mono text-foreground break-all">••••••••</span>
            )}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="btn-secondary text-xs py-1 h-8 inline-flex items-center gap-1"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPassword ? "Hide" : "Show"}
            </button>
          </dd>
        </div>
        {rootPassKey && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground mb-1">Root password</dt>
            <dd className="font-mono text-foreground break-all">
              {showPassword ? (
                rootPassKey && env[rootPassKey] ? (
                  <span>{env[rootPassKey]}</span>
                ) : rootPassStoreMode === "secret" ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs font-normal">
                    <Lock className="w-3.5 h-3.5" />
                    Not readable (Docker Secrets)
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              ) : (
                "••••••••"
              )}
            </dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground mb-1">Replicas</dt>
          <dd className="space-y-2">
            {!editingReplicas ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                <span className="font-mono text-foreground">{replicas}</span>
                <button
                  type="button"
                  disabled={!hasStack}
                  onClick={() => {
                    setEditingReplicas(true);
                    setReplicasDraft(String(replicas));
                  }}
                  className="btn-secondary text-xs py-1.5 h-8 self-start disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Change replicas
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-w-md">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="input-field font-mono text-sm max-w-[8rem] py-2"
                    value={replicasDraft}
                    onChange={(e) => setReplicasDraft(e.target.value)}
                    disabled={replicasSaving}
                  />
                  <span className="text-xs text-muted-foreground">(1–10, Swarm)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={replicasSaving}
                    onClick={() => void saveReplicas()}
                    className="btn-primary text-xs py-1.5 h-8 inline-flex items-center gap-1.5"
                  >
                    {replicasSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {replicasSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={replicasSaving}
                    onClick={() => {
                      setEditingReplicas(false);
                      setReplicasDraft(String(replicas));
                    }}
                    className="btn-secondary text-xs py-1.5 h-8"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground mb-1">Host port (→ {containerPort})</dt>
          <dd className="space-y-2">
            {!editingHostPort ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                <span className="font-mono text-foreground">
                  {hostPort != null ? (
                    <>
                      <span className="text-emerald-400">{hostPort}</span>
                      <span className="text-muted-foreground"> → {containerPort} on host</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Not published
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={!hasStack}
                  onClick={() => {
                    setEditingHostPort(true);
                    setPortDraft(hostPort != null ? String(hostPort) : "");
                  }}
                  className="btn-secondary text-xs py-1.5 h-8 self-start disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Change port
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-w-md">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input-field font-mono text-sm max-w-[10rem] py-2"
                    value={portDraft}
                    onChange={(e) => setPortDraft(e.target.value)}
                    placeholder="e.g. 5432"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={portSaving}
                  />
                  <span className="text-xs text-muted-foreground">→ container {containerPort}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Leave empty and save to stop publishing on the host. After saving, redeploy the service.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={portSaving}
                    onClick={() => void saveHostPort()}
                    className="btn-primary text-xs py-1.5 h-8 inline-flex items-center gap-1.5"
                  >
                    {portSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {portSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={portSaving}
                    onClick={() => {
                      setEditingHostPort(false);
                      setPortDraft(hostPort != null ? String(hostPort) : "");
                    }}
                    className="btn-secondary text-xs py-1.5 h-8"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function DatabaseSetupForm({ serviceId, engine }: { serviceId: string; engine: DatabaseEngineId }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dbName, setDbName] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [storeDbName, setStoreDbName] = useState<"env" | "secret">("env");
  const [storeUser, setStoreUser] = useState<"env" | "secret">("env");
  const [storePass, setStorePass] = useState<"env" | "secret">("secret");
  const [rootUser, setRootUser] = useState("");
  const [rootPass, setRootPass] = useState("");
  const [storeRootUser, setStoreRootUser] = useState<"env" | "secret">("env");
  const [storeRootPass, setStoreRootPass] = useState<"env" | "secret">("secret");
  const [password, setPassword] = useState("");
  const [storePassword, setStorePassword] = useState<"env" | "secret">("secret");
  const [replicas, setReplicas] = useState(1);
  const [publishPort, setPublishPort] = useState("");
  const [image, setImage] = useState(defaultDatabaseImage(engine));
  const [volumePath, setVolumePath] = useState(defaultDatabaseVolumePath(engine));
  const [imageUnlocked, setImageUnlocked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setImage(defaultDatabaseImage(engine));
    setVolumePath(defaultDatabaseVolumePath(engine));
    setImageUnlocked(false);
  }, [engine]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const dbRequired = engine !== "redis";
    const needUserPass = engine === "postgres" || engine === "mysql" || engine === "mariadb";
    const needRootPass = engine === "mysql" || engine === "mariadb";
    const needMongoRoot = engine === "mongodb";
    const needRedisPassword = engine === "redis";

    if (dbRequired && !dbName.trim()) {
      toast({
        title: "Missing fields",
        description: "Database name is required.",
        variant: "destructive",
      });
      return;
    }
    if (needUserPass && (!user.trim() || !pass.trim())) {
      toast({
        title: "Missing fields",
        description: "User and password are required.",
        variant: "destructive",
      });
      return;
    }
    if (needRootPass && !rootPass.trim()) {
      toast({
        title: "Missing fields",
        description: "Root password is required.",
        variant: "destructive",
      });
      return;
    }
    if (needMongoRoot && (!rootUser.trim() || !rootPass.trim())) {
      toast({
        title: "Missing fields",
        description: "Root username and root password are required.",
        variant: "destructive",
      });
      return;
    }
    if (needRedisPassword && !password.trim()) {
      toast({
        title: "Missing fields",
        description: "Password is required for Redis.",
        variant: "destructive",
      });
      return;
    }
    const pp = publishPort.trim();
    if (pp) {
      const n = parseInt(pp, 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        toast({
          title: "Invalid host port",
          description: "Use an integer from 1 to 65535, or leave empty for no published port.",
          variant: "destructive",
        });
        return;
      }
    }
    const img = image.trim();
    if (img && !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,127}$/.test(img)) {
      toast({
        title: "Invalid image",
        description: "Use a valid Docker image reference (letters, digits, ._/:@-).",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await applyDatabaseApi(serviceId, engine, {
        ...(dbRequired ? { dbName: dbName.trim() } : {}),
        ...(needUserPass ? { user: user.trim(), pass } : {}),
        ...(needMongoRoot ? { rootUser: rootUser.trim(), rootPass } : {}),
        ...(needRootPass ? { rootPass } : {}),
        ...(needRedisPassword ? { password } : {}),
        ...(dbRequired ? { storeDbName } : {}),
        ...(needUserPass ? { storeUser, storePass } : {}),
        ...(needMongoRoot ? { storeRootUser, storeRootPass } : {}),
        ...(needRootPass ? { storeRootPass } : {}),
        ...(needRedisPassword ? { storePassword } : {}),
        ...(volumePath.trim() ? { volumePath: volumePath.trim() } : {}),
        replicas: Math.min(10, Math.max(1, Math.floor(replicas) || 1)),
        ...(pp ? { publishPort: parseInt(pp, 10) } : {}),
        ...(img ? { image: img } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["service", serviceId] });
      toast({
        title: "Stack YAML saved",
        description:
          "Credentials are stored under Environment. Deploy from the header to run docker stack deploy.",
      });
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl border border-amber-500/20 p-6 md:p-8">
      <h3 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Database className="w-5 h-5 text-amber-400" />
        Complete {getDatabaseEngineById(engine)?.name ?? "Database"} setup
      </h3>
      <p className="text-sm text-muted-foreground mb-5 max-w-2xl leading-relaxed">
        This service has no saved stack yet. Prefer creating database services from{" "}
        <span className="text-foreground font-medium">Add Service</span> so credentials are set at creation. Here you can generate the stack once; after that this form locks.
      </p>
      <div className="mb-5 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground block">Docker image</label>
        <div className="relative max-w-2xl">
          <input
            className={`input-field w-full font-mono text-sm pr-10 ${!imageUnlocked ? "bg-zinc-950/80 !text-zinc-500 border-white/10 cursor-not-allowed" : ""}`}
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder={defaultDatabaseImage(engine)}
            autoComplete="off"
            readOnly={!imageUnlocked}
            title={!imageUnlocked ? "Unlock to edit image" : undefined}
          />
          <button
            type="button"
            onClick={() => setImageUnlocked((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10"
            aria-label={imageUnlocked ? "Lock image field" : "Unlock image field"}
          >
            {imageUnlocked ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </button>
        </div>
        {imageUnlocked && (
          <p className="text-[11px] text-amber-500/90 leading-snug rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 max-w-2xl">
            Warning: Data storage path can differ between image versions. Verify the path and update the volume mount to match the selected version.
          </p>
        )}
        {imageUnlocked && (
          <div className="max-w-2xl space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground block">Volume path</label>
            <input
              className="input-field w-full font-mono text-sm"
              value={volumePath}
              onChange={(e) => setVolumePath(e.target.value)}
              placeholder={`default: ${defaultDatabaseVolumePath(engine)}`}
              autoComplete="off"
            />
          </div>
        )}
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 max-w-2xl">
        {engine !== "redis" && (
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Database name</label>
            <input
              className="input-field w-full font-mono text-sm"
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder="myapp-db"
              autoComplete="off"
            />
            <select className="input-field mt-1.5 w-full max-w-[12rem] text-xs" value={storeDbName} onChange={(e) => setStoreDbName(e.target.value as "env" | "secret")}>
              <option value="env">Store in Environment</option>
              <option value="secret">Store in Docker Secret</option>
            </select>
          </div>
        )}
        {(engine === "postgres" || engine === "mysql" || engine === "mariadb") && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">User</label>
              <input
                className="input-field w-full font-mono text-sm"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="appuser"
                autoComplete="off"
              />
              <select className="input-field mt-1.5 w-full max-w-[12rem] text-xs" value={storeUser} onChange={(e) => setStoreUser(e.target.value as "env" | "secret")}>
                <option value="env">Store in Environment</option>
                <option value="secret">Store in Docker Secret</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password</label>
              <input
                type="password"
                className="input-field w-full font-mono text-sm"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              <select className="input-field mt-1.5 w-full max-w-[12rem] text-xs" value={storePass} onChange={(e) => setStorePass(e.target.value as "env" | "secret")}>
                <option value="secret">Store in Docker Secret</option>
                <option value="env">Store in Environment</option>
              </select>
            </div>
          </>
        )}
        {(engine === "mysql" || engine === "mariadb") && (
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root password</label>
            <input
              type="password"
              className="input-field w-full font-mono text-sm"
              value={rootPass}
              onChange={(e) => setRootPass(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <select className="input-field mt-1.5 w-full max-w-[12rem] text-xs" value={storeRootPass} onChange={(e) => setStoreRootPass(e.target.value as "env" | "secret")}>
              <option value="secret">Store in Docker Secret</option>
              <option value="env">Store in Environment</option>
            </select>
          </div>
        )}
        {engine === "mongodb" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root username</label>
              <input
                className="input-field w-full font-mono text-sm"
                value={rootUser}
                onChange={(e) => setRootUser(e.target.value)}
                placeholder="root"
                autoComplete="off"
              />
              <select className="input-field mt-1.5 w-full max-w-[12rem] text-xs" value={storeRootUser} onChange={(e) => setStoreRootUser(e.target.value as "env" | "secret")}>
                <option value="env">Store in Environment</option>
                <option value="secret">Store in Docker Secret</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root password</label>
              <input
                type="password"
                className="input-field w-full font-mono text-sm"
                value={rootPass}
                onChange={(e) => setRootPass(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              <select className="input-field mt-1.5 w-full max-w-[12rem] text-xs" value={storeRootPass} onChange={(e) => setStoreRootPass(e.target.value as "env" | "secret")}>
                <option value="secret">Store in Docker Secret</option>
                <option value="env">Store in Environment</option>
              </select>
            </div>
          </>
        )}
        {engine === "redis" && (
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password</label>
            <input
              type="password"
              className="input-field w-full font-mono text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <select className="input-field mt-1.5 w-full max-w-[12rem] text-xs" value={storePassword} onChange={(e) => setStorePassword(e.target.value as "env" | "secret")}>
              <option value="secret">Store in Docker Secret</option>
              <option value="env">Store in Environment</option>
            </select>
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Replicas (1–10)</label>
          <input
            type="number"
            min={1}
            max={10}
            className="input-field w-full max-w-[8rem] font-mono text-sm"
            value={replicas}
            onChange={(e) => setReplicas(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Host port <span className="text-muted-foreground/80 font-normal">(optional)</span>
          </label>
          <input
            className="input-field w-full max-w-[8rem] font-mono text-sm"
            value={publishPort}
            onChange={(e) => setPublishPort(e.target.value)}
            placeholder={`e.g. ${dbPortByEngine(engine)}`}
            inputMode="numeric"
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
            Empty = no host port (not exposed externally).
          </p>
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Generate & save stack YAML
          </button>
        </div>
      </form>
    </div>
  );
}

function ApplicationArchivePanel({
  serviceId,
  projectId,
  service,
}: {
  serviceId: string;
  projectId: string;
  service: Service;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: serviceRow } = useService(serviceId);
  const [file, setFile] = useState<File | null>(null);
  const [buildPath, setBuildPath] = useState(".");
  const [containerPort, setContainerPort] = useState("3000");
  const [publishPort, setPublishPort] = useState("");
  const [replicas, setReplicas] = useState("1");
  const [uploading, setUploading] = useState(false);
  const [variablesText, setVariablesText] = useState("");
  type AppEnvVarRow = {
    key: string;
    value: string;
    store: "env" | "secret";
    /** True when this row was loaded from saved stack for a Docker Secret (value not readable from API). */
    unreadableDockerSecret?: boolean;
  };
  const [variables, setVariables] = useState<AppEnvVarRow[]>([]);
  /** Show/hide value for Environment and editable Docker Secret rows (default hidden). Hidden after generate for unreadable secrets. */
  const [valueVisibleByRow, setValueVisibleByRow] = useState<Record<number, boolean>>({});
  const [showEnvPaste, setShowEnvPaste] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [zipDragOver, setZipDragOver] = useState(false);
  const [connectionExternal, setConnectionExternal] = useState<string[]>([]);
  const [connectionStackKeys, setConnectionStackKeys] = useState<string[]>([]);
  const [openAppSection, setOpenAppSection] = useState<"connections" | "env" | null>(null);

  const filledEnvVarCount = useMemo(
    () => variables.filter((v) => v.key.trim()).length,
    [variables],
  );

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    const p = parseApplicationNetworkHeaders(cfg);
    setConnectionExternal(p.external);
    setConnectionStackKeys(p.stack.length ? p.stack : []);
  }, [serviceRow?.id, serviceRow?.config]);

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    if (!cfg.includes("# weehawk application service")) return;
    const stores = parseApplicationStoreHeaders(cfg);
    const keys = Object.keys(stores);
    if (keys.length === 0) return;
    const envMap = parseServiceEnvLines(serviceRow?.env ?? "");
    setVariables(
      keys.map((key) => ({
        key,
        // Secret values are not readable back from Docker; keep blank in UI.
        value: stores[key] === "env" ? (envMap[key] ?? "") : "",
        store: stores[key],
        unreadableDockerSecret: stores[key] === "secret",
      })),
    );
    setValueVisibleByRow({});
  }, [serviceRow?.id, serviceRow?.config, serviceRow?.env]);

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    if (!cfg.includes("# weehawk application service")) return;
    const savedPath = parseApplicationBuildPath(cfg);
    if (savedPath) setBuildPath(savedPath);
  }, [serviceRow?.config]);

  const updateVariable = (idx: number, patch: Partial<AppEnvVarRow>) => {
    setVariables((prev) =>
      prev.map((v, i) => {
        if (i !== idx) return v;
        const next = { ...v, ...patch };
        if (patch.value !== undefined && patch.value.trim() !== "") {
          next.unreadableDockerSecret = false;
        }
        if (patch.store !== undefined && patch.store !== "secret") {
          next.unreadableDockerSecret = false;
        }
        return next;
      }),
    );
  };
  const addVariable = () => setVariables((prev) => [...prev, { key: "", value: "", store: "secret" }]);
  const removeVariable = (idx: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== idx));
    setValueVisibleByRow((prev) => {
      const next: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (Number.isNaN(i)) continue;
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
  };
  const parseVariablesText = () => {
    const parsed: AppEnvVarRow[] = [];
    for (const rawLine of variablesText.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1);
      parsed.push({ key, value, store: "secret" });
    }
    setVariables(parsed);
    setValueVisibleByRow({});
    toast({
      title: "Variables loaded",
      description: `${parsed.length} variable(s) parsed. Default store is Docker Secret.`,
    });
  };

  const setZipFile = (f: File | null) => {
    if (!f) {
      setFile(null);
      return;
    }
    if (!f.name.toLowerCase().endsWith(".zip")) {
      toast({ title: "Invalid file", description: "Only .zip archives are supported.", variant: "destructive" });
      return;
    }
    setFile(f);
  };

  const onUpload = async () => {
    if (!file) {
      toast({ title: "Choose a ZIP file", description: "Upload your project ZIP first.", variant: "destructive" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast({ title: "Invalid file", description: "Only .zip archives are supported.", variant: "destructive" });
      return;
    }
    const cp = parseInt(containerPort || "3000", 10);
    const rp = publishPort.trim() ? parseInt(publishPort.trim(), 10) : undefined;
    const rep = parseInt(replicas || "1", 10);
    const cleanVars = variables
      .map((v) => ({ key: v.key.trim(), value: v.value, store: v.store }))
      .filter((v) => v.key.length > 0);
    for (const v of cleanVars) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(v.key)) {
        toast({ title: "Invalid variable key", description: `Key "${v.key}" is invalid.`, variant: "destructive" });
        return;
      }
    }
    if (!Number.isInteger(cp) || cp < 1 || cp > 65535) {
      toast({ title: "Invalid container port", description: "Use 1-65535.", variant: "destructive" });
      return;
    }
    if (rp != null && (!Number.isInteger(rp) || rp < 1 || rp > 65535)) {
      toast({ title: "Invalid host port", description: "Use 1-65535 or leave empty.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(rep) || rep < 1 || rep > 10) {
      toast({ title: "Invalid replicas", description: "Use a value between 1 and 10.", variant: "destructive" });
      return;
    }

    const stk = connectionStackKeys.map((k) => k.trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const k of stk) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,62}$/.test(k)) {
        toast({
          title: "Invalid extra path name",
          description: "Use letters and numbers; start with a letter.",
          variant: "destructive",
        });
        return;
      }
      const low = k.toLowerCase();
      if (seen.has(low)) {
        toast({
          title: "Duplicate name",
          description: "Each extra path needs a unique name.",
          variant: "destructive",
        });
        return;
      }
      seen.add(low);
    }

    setUploading(true);
    try {
      await uploadApplicationArchiveApi(serviceId, file, {
        buildPath: buildPath.trim() || ".",
        buildMode: "dockerfile",
        containerPort: cp,
        publishPort: rp,
        replicas: rep,
        variables: cleanVars,
        networks: { external: connectionExternal, stack: stk },
      });
      await queryClient.invalidateQueries({ queryKey: ["service", serviceId] });
      toast({
        title: "Application source uploaded",
        description: "Stack config is generated. Deploy to build image and run the stack.",
      });
      setFile(null);
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const formatZipSize = (bytes: number) =>
    bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

  return (
    <div className="glass-panel rounded-2xl border border-violet-500/20 p-6 md:p-8">
      <h3 className="text-base font-semibold flex items-center gap-2 mb-1">
        <PackageOpen className="w-5 h-5 text-violet-300" />
        Application deploy Form
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
        <div className="sm:col-span-2 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Source</label>
            <p className="text-[11px] text-muted-foreground/90 mb-2 max-w-xl">
              Connect a repository later. For now, upload a project ZIP from your machine.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 sm:items-stretch">
            <button
              type="button"
              disabled
              title="Coming soon"
              className="flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-center opacity-60 cursor-not-allowed"
            >
              <Image
                src="/deployment-sources/github.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
              <span className="text-xs font-medium text-foreground">GitHub</span>
              <span className="text-[10px] leading-tight text-muted-foreground">Soon</span>
            </button>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-center opacity-60 cursor-not-allowed"
            >
              <Image
                src="/deployment-sources/gitlab.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
              <span className="text-xs font-medium text-foreground">GitLab</span>
              <span className="text-[10px] leading-tight text-muted-foreground">Soon</span>
            </button>
            <div className="relative min-h-0 sm:min-h-0">
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                aria-label="Choose project ZIP file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setZipFile(f);
                  e.target.value = "";
                }}
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => zipInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    zipInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setZipDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setZipDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setZipDragOver(false);
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) setZipFile(dropped);
                }}
                className={`group relative flex h-full min-h-[4.75rem] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  zipDragOver
                    ? "border-primary bg-primary/10"
                    : "border-violet-500/35 bg-black/30 hover:border-violet-500/55 hover:bg-violet-500/5"
                }`}
              >
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                  <Image
                    src="/deployment-sources/upload-cloud.png"
                    alt=""
                    width={36}
                    height={36}
                    className="h-9 w-9 object-contain drop-shadow-sm"
                    priority={false}
                  />
                </span>
                <div className="w-full space-y-0.5 px-0.5">
                  <p className="text-xs font-medium text-foreground">Upload ZIP</p>
                  <p
                    className="text-[11px] leading-snug text-foreground/90 line-clamp-2 break-all"
                    title={file ? file.name : undefined}
                  >
                    {file ? file.name : "Drop ZIP or click"}
                  </p>
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    {file ? `${formatZipSize(file.size)} · replace` : ".zip only"}
                  </p>
                </div>
                {file && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                    className="absolute right-1 top-1 z-10 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    aria-label="Remove file"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Build path</label>
          <input className="input-field font-mono text-sm" value={buildPath} onChange={(e) => setBuildPath(e.target.value)} placeholder="." />
        </div>
        <div className="sm:col-span-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
          <p className="text-xs font-medium text-foreground mb-1">Dockerfile-first build</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            If your project includes a <code className="text-[10px]">Dockerfile</code> in the build path, it is used as-is.
            Otherwise Weehawk generates a multi-stage Dockerfile (Node, Go, Python, or static) inside the same context — flat{" "}
            <code className="text-[10px]">/app</code>, symlink-safe, and <code className="text-[10px]">npm ci</code> for Node.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Container port</label>
          <input className="input-field font-mono text-sm" value={containerPort} onChange={(e) => setContainerPort(e.target.value)} placeholder="3000" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Host port (optional)</label>
          <input className="input-field font-mono text-sm" value={publishPort} onChange={(e) => setPublishPort(e.target.value)} placeholder="8080" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Replicas (1-10)</label>
          <input className="input-field font-mono text-sm" value={replicas} onChange={(e) => setReplicas(e.target.value)} placeholder="1" />
        </div>
        <div className="sm:col-span-2 flex flex-col gap-2">
          <ApplicationConnectionsPanel
            service={service}
            projectId={projectId}
            variant="embedded"
            external={connectionExternal}
            stackKeys={connectionStackKeys}
            onExternalChange={setConnectionExternal}
            onStackKeysChange={setConnectionStackKeys}
            open={openAppSection === "connections"}
            onOpenChange={(next) => setOpenAppSection(next ? "connections" : null)}
          />
          <details
            className="group"
            open
          >
            <summary
              onClick={(e) => {
                e.preventDefault();
                setOpenAppSection((prev) => (prev === "env" ? null : "env"));
              }}
              className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/10 bg-zinc-950/30 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10">
                <Variable className="h-3.5 w-3.5 text-violet-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-violet-100">Environment and secrets</h3>
                  {filledEnvVarCount > 0 && (
                    <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                      {filledEnvVarCount}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Keys & values — Docker Secret or env; included when you upload.
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${
                  openAppSection === "env" ? "rotate-180" : ""
                }`}
              />
            </summary>
            <div
              className={`grid min-h-0 overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
                openAppSection === "env" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-80"
              }`}
            >
              <div className="min-h-0 space-y-2 pt-3">
              {variables.length === 0 && (
                <p className="text-xs text-muted-foreground">Paste .env then click parse. You can still add rows manually.</p>
              )}
              {variables.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <input
                    className="input-field font-mono text-sm col-span-4"
                    value={row.key}
                    onChange={(e) => updateVariable(idx, { key: e.target.value })}
                    placeholder="DATABASE_URL"
                  />
                  {row.store === "secret" && row.unreadableDockerSecret && !row.value.trim() ? (
                    <div className="input-field col-span-5 flex min-h-[2.5rem] items-center px-3 font-mono text-xs text-muted-foreground">
                      Not readable (Docker Secrets)
                    </div>
                  ) : (
                    <>
                      <input
                        type={valueVisibleByRow[idx] ? "text" : "password"}
                        className="input-field font-mono text-sm col-span-4"
                        value={row.value}
                        onChange={(e) => updateVariable(idx, { value: e.target.value })}
                        placeholder="value"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="btn-secondary text-xs col-span-1"
                        onClick={() =>
                          setValueVisibleByRow((prev) => ({ ...prev, [idx]: !prev[idx] }))
                        }
                        title={valueVisibleByRow[idx] ? "Hide value" : "Show value"}
                        aria-label={valueVisibleByRow[idx] ? "Hide value" : "Show value"}
                      >
                        {valueVisibleByRow[idx] ? (
                          <EyeOff className="w-3.5 h-3.5 mx-auto" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 mx-auto" />
                        )}
                      </button>
                    </>
                  )}
                  <select
                    className="input-field text-sm col-span-2"
                    value={row.store}
                    onChange={(e) => {
                      const nextStore = e.target.value as "env" | "secret";
                      updateVariable(idx, { store: nextStore });
                      setValueVisibleByRow((prev) => {
                        const next = { ...prev };
                        delete next[idx];
                        return next;
                      });
                    }}
                  >
                    <option value="secret">Docker Secret</option>
                    <option value="env">Environment</option>
                  </select>
                  <button
                    type="button"
                    className="btn-secondary text-xs col-span-1"
                    onClick={() => removeVariable(idx)}
                    disabled={variables.length === 0}
                    title="Remove row"
                  >
                    <Trash2 className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button type="button" onClick={addVariable} className="btn-secondary text-xs inline-flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Add variable
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnvPaste((v) => !v)}
                  className="btn-secondary text-xs inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Paste .env values
                </button>
              </div>
              <AnimatePresence initial={false}>
                {showEnvPaste && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-2">
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Paste .env values</label>
                      <textarea
                        className="input-field w-full min-h-[140px] font-mono text-xs"
                        value={variablesText}
                        onChange={(e) => setVariablesText(e.target.value)}
                        placeholder={"DATABASE_URL=postgres://...\nNODE_ENV=production\nPORT=3000"}
                      />
                      <div className="mt-2">
                        <button type="button" onClick={parseVariablesText} className="btn-secondary text-xs inline-flex items-center gap-1.5">
                          <Plus className="w-3.5 h-3.5" /> Parse from .env
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            </div>
          </details>
        </div>
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => void onUpload()}
            disabled={uploading}
            className="btn-primary text-sm inline-flex items-center gap-2"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageOpen className="w-4 h-4" />}
            {uploading ? "Uploading..." : "Upload and generate stack"}
          </button>
        </div>
      </div>
    </div>
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
