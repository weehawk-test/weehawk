"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Container, Layers, Copy, Trash2, FileCode,
  Info, Hash, FolderKanban, CheckCircle, XCircle,
  Download, Edit3, Save, X, Calendar, Tag, Plus,
  Terminal, Rocket, RefreshCw, Square, Play, RotateCw, Activity, Loader2,
  Shield, Variable, Globe, ExternalLink, Link2, ScrollText, Archive, Server, ChevronDown, ChevronRight,
  Database, Eye, EyeOff, Lock, HardDrive, AlertCircle, Upload, Cloud,
  LockOpen,
  PackageOpen,
  ArrowDownToLine,
  Search,
} from "lucide-react";
import {
  useService,
  useDeleteService,
  useShutdownService,
  useStartService,
  useServiceRuntime,
  useServiceVolumes,
  useUpdateService,
} from "@/hooks/use-services";
import { useProject } from "@/hooks/use-projects";
import { useDockerSecretsPagedWithInitialData } from "@/hooks/use-docker-secrets";
import { getDeployLogText, useDeploy, useDeployLogs } from "@/hooks/use-deploy-logs";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import type { Project, Service, TraefikRouteRule } from "@/lib/schema";
import {
  databaseLogoBlendClass,
  parseDatabaseEngineFromConfig,
  getDatabaseEngineById,
  defaultDatabaseImage,
  defaultDatabaseVolumePath,
  type DatabaseEngineId,
} from "@/lib/database-engines";
import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchGitSettings,
  fetchGithubRepositories,
  fetchGitlabProjects,
  type GithubRepoListItem,
  type GithubRepositoriesListResponse,
  type GitlabProjectListItem,
  type GitlabProjectsListResponse,
} from "@/lib/git-api";
import {
  applyDatabaseApi,
  streamServiceLogs,
  updateDatabaseStackApi,
  patchApplicationImageDeployApi,
  uploadApplicationArchiveApi,
  applicationGitCloneStageApi,
  generateApplicationFromSourceApi,
  runServiceBackupNowApi,
  importServiceBackupFromS3Api,
} from "@/lib/services-api";
import {
  parseApplicationBuildPath,
  parseApplicationDeployMode,
  parseApplicationImageRef,
  parseApplicationNetworkHeaders,
  parseApplicationStoreHeaders,
  parseApplicationYamlPorts,
  parseServiceEnvLines,
  parseYamlImage,
  parseYamlPublishPort,
  parseYamlReplicas,
} from "@/lib/env-utils";
import { ApplicationConnectionsPanel } from "./application-connections-panel";
import { ServiceTerminalPanel } from "./service-terminal-panel";
import { ServiceRemoteHostPanel } from "./service-remote-host-panel";
import { ServiceSecretsTab } from "./service-secrets-tab";
import { DatabaseBackupFormFields } from "@/components/database-backup-form-fields";
import { VolumeBackupDbWarning } from "@/components/volume-backup-db-warning";
import { S3ImportObjectPicker } from "@/components/s3/S3ImportObjectPicker";
import { listDatabaseBackupOptions } from "@/lib/database-backup-from-service";
import {
  resolveBackupFormat,
  validateDatabaseBackupForm,
  type DatabaseBackupConfig,
  type DatabaseBackupFormValues,
} from "@/lib/database-backup-preview";
import { buildDatabaseInternalConnectionUrl, DB_URL_PASSWORD_PLACEHOLDER } from "@/lib/database-internal-url";
import { listS3ProfilesApi, type S3BucketListResponse, type S3ProfilePublic } from "@/lib/s3-api";
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
    color: "bg-white/5 text-zinc-200 border-border",
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
  | "dbdetails"
  | "config"
  | "appconf"
  | "env"
  | "remote"
  | "backup"
  | "domain"
  | "secrets"
  | "logs"
  | "terminal";

/** Hidden for database services until stack YAML exists (Postgres form saved). */
const DATABASE_PRECOMPOSE_HIDDEN: Tab[] = ["config", "remote", "backup", "terminal"];

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

function countTraefikRoutesOrDomains(service: Service | null | undefined): number | undefined {
  if (!service) return undefined;
  const tr = service.traefikRoutes;
  if (tr && tr.length > 0) return tr.length;
  const d = service.domains?.length ?? 0;
  return d > 0 ? d : undefined;
}

function defaultTraefikRouterName(appName?: string): string {
  let s = (appName ?? "app")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
  if (!s) s = "app";
  if (!/^[a-z]/.test(s)) s = `a${s}`;
  return s.slice(0, 63);
}

function parseHostInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((x) => x.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
}

function buildInitialTraefikRoutes(service: Service): TraefikRouteRule[] {
  const tr = service.traefikRoutes;
  if (tr && tr.length > 0) return tr.map((r) => ({ ...r }));
  if (service.domains?.length) {
    return [
      {
        router: defaultTraefikRouterName(service.appName),
        hosts: [...service.domains],
        pathPrefix: null,
        port: null,
      },
    ];
  }
  return [
    {
      router: defaultTraefikRouterName(service.appName),
      hosts: [],
      pathPrefix: null,
      port: null,
    },
  ];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export type ServiceS3ImportSsr = {
  mode: "db" | "vol";
  profileName: string;
  prefix: string;
  initialList: S3BucketListResponse | null;
};

type ServiceDetailsProps = {
  initialService?: Service | null;
  initialProject?: Project | null;
  initialRuntime?: { running: boolean } | null;
  initialSecretsPaged?: PaginatedSecretsResponse | null;
  s3ImportSsr?: ServiceS3ImportSsr | null;
  /** S3 destinations from server (no client fetch on first paint). */
  initialS3Profiles?: S3ProfilePublic[];
};

export default function ServiceDetails({
  initialService,
  initialProject,
  initialRuntime,
  initialSecretsPaged,
  s3ImportSsr,
  initialS3Profiles,
}: ServiceDetailsProps) {
  const { id: projectId, serviceId } = useParams<{ id: string; serviceId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
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
    skipClientFetch: Boolean(initialProject),
  });

  useEffect(() => {
    if (initialProject && projectId) {
      qc.setQueryData(["projects", projectId], initialProject);
    }
  }, [initialProject, projectId, qc]);

  useEffect(() => {
    if (initialService && serviceId) {
      qc.setQueryData(["service", serviceId], initialService);
    }
  }, [initialService, serviceId, qc]);

  const { data: secretsPaged } = useDockerSecretsPagedWithInitialData(1, "", {
    initialData: initialSecretsPaged ?? undefined,
    enabled: (service ?? initialService)?.type !== "application",
  });
  const deleteService = useDeleteService();
  const shutdownService = useShutdownService();
  const startService = useStartService();
  const updateService = useUpdateService();
  const deploy = useDeploy();
  const deployLogQuery = useDeployLogs(serviceId);
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
    const dbEngineForTabs =
      service?.type === "databases" ? parseDatabaseEngineFromConfig(service.config ?? "") : undefined;
    const head: TabDef[] = [
      { id: "overview", label: "Overview", icon: Info },
      ...(dbEngineForTabs ? [{ id: "dbdetails" as Tab, label: "Database", icon: Database }] : []),
      { id: "config", label: "Configuration", icon: FileCode },
    ];
    const appConf: TabDef = { id: "appconf", label: "Build & deployment", icon: PackageOpen };
    const tail: TabDef[] = [
      { id: "env", label: "Environment", icon: Variable, count: envEntryCount || undefined },
      { id: "remote", label: "Remote", icon: Server },
      { id: "backup", label: "Backup", icon: Archive },
      {
        id: "domain",
        label: "Domains",
        icon: Globe,
        count: countTraefikRoutesOrDomains(service),
      },
      { id: "secrets", label: "Secrets", icon: Shield, count: secretsPaged?.totalAll },
      { id: "logs", label: "Logs", icon: ScrollText },
      { id: "terminal", label: "Terminal", icon: Terminal },
    ];
    const allTabs: TabDef[] = isApplicationService ? [...head, appConf, ...tail] : [...head, ...tail];
    const withoutAppComposeTabs = isApplicationService
      ? allTabs.filter((t) => t.id !== "config" && t.id !== "env" && t.id !== "secrets")
      : allTabs;
    if (!isDatabaseService) return withoutAppComposeTabs;
    const withoutDomainSecrets = withoutAppComposeTabs.filter(
      (t) =>
        t.id !== "domain" &&
        t.id !== "secrets" &&
        t.id !== "env" &&
        t.id !== "config",
    );
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
    service?.traefikRoutes,
    secretsPaged?.totalAll,
    service?.type,
    service?.config,
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
          const isDb = service.type === "databases";
          if (log.status === "success") {
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
            return;
          }
          const detail = getDeployLogText(log).trim() || "No output was returned. Check API logs or network.";
          const max = 900;
          toast({
            title: mode === "redeploy" ? "Redeploy failed" : "Deploy failed",
            description:
              detail.length > max ? `${detail.slice(0, max)}…` : detail,
            variant: "destructive",
          });
        },
        onError: (e: Error) => {
          toast({
            title: mode === "redeploy" ? "Redeploy failed" : "Deploy failed",
            description: e.message,
            variant: "destructive",
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
        <Link href="/">
          <span className="hover:text-foreground cursor-pointer flex items-center gap-1 transition-colors">
            <FolderKanban className="w-3.5 h-3.5" /> Projects
          </span>
        </Link>
        <span className="text-muted-foreground/35">/</span>
        <Link href={`/projects/${projectId}`}>
          <span className="hover:text-foreground cursor-pointer transition-colors">{project?.name ?? "Project"}</span>
        </Link>
        <span className="text-muted-foreground/35">/</span>
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
        <div className="flex gap-1 p-1 bg-card/50 rounded-xl border border-border w-fit overflow-x-auto">
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
                  <motion.div layoutId="tab-bg" className="absolute inset-0 bg-white/10 rounded-lg border border-border"
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
              {!isApplicationService && (
                <>
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
                </>
              )}
              </div>
            </motion.div>
          )}

          {/* ── Database (credentials, replicas, port, internal URL) — databases + engine in compose only ── */}
          {activeTab === "dbdetails" && isDatabaseService && dbEngineId && (
            <motion.div
              key="dbdetails"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <DatabaseSetupPanel serviceId={service.id} service={service} engine={dbEngineId} />
            </motion.div>
          )}

          {/* ── Build & deployment (ZIP / Git / deploy flow); remote hosts → Remote tab ── */}
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

          {activeTab === "remote" && (
            <motion.div
              key="remote"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <ServiceRemoteHostPanel service={service} />
            </motion.div>
          )}

          {/* ── CONFIGURATION ── */}
          {activeTab === "config" && (
            <motion.div key="config" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="glass-panel rounded-2xl overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">{service.name}.yml</span>
                  <span className={`text-xs border rounded-full px-2 py-0.5 ${typeConf.color}`}>{typeConf.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {editingConfig ? (
                    <>
                      <button onClick={() => setEditingConfig(false)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors">
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
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors">
                        <Edit3 className="w-3.5 h-3.5" />Edit
                      </button>
                      {service.config && <>
                        <button onClick={() => { navigator.clipboard.writeText(service.config); toast({ title: "Copied!" }); }}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors">
                          <Copy className="w-3.5 h-3.5" />Copy
                        </button>
                        <button onClick={handleDownload}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors">
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
                  className="w-full bg-zinc-100 text-zinc-900 dark:bg-black/70 dark:text-emerald-200 font-mono text-xs p-5 min-h-[420px] resize-y outline-none border-none leading-relaxed placeholder:text-muted-foreground"
                  spellCheck={false}
                />
              ) : service.config ? (
                <div className="bg-zinc-100 dark:bg-black/70 overflow-x-auto">
                  <table className="w-full border-collapse text-xs font-mono leading-relaxed">
                    <tbody>
                      {service.config.split("\n").map((line, i) => (
                        <tr key={i} className="hover:bg-accent/40 transition-colors">
                          <td className="select-none text-right pr-4 pl-4 py-0.5 text-zinc-600 border-r border-border/60 min-w-[3rem] w-10">{i + 1}</td>
                          <td className="pl-5 pr-5 py-0.5 whitespace-pre">{colorizeYaml(line)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-muted/55 dark:bg-black/50 p-12 text-center">
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

          {/* ── ENVIRONMENT VARIABLES (.env); remote hosts → Remote tab ── */}
          {activeTab === "env" && (
            <motion.div key="env" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="space-y-4">
              <EnvFilePanel service={service} />
            </motion.div>
          )}

          {activeTab === "backup" && (
            <motion.div key="backup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="space-y-4">
              <ServiceBackupPanel
                serviceId={serviceId}
                service={service ?? null}
                isDatabaseService={isDatabaseService}
                s3ImportSsr={s3ImportSsr}
                initialS3Profiles={initialS3Profiles}
              />
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

                {deploy.isPending ? (
                  <div className="px-5 py-2.5 border-b border-amber-500/25 bg-amber-500/10 shrink-0 flex items-start gap-2 text-xs text-amber-100/95 leading-snug">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
                    <span>
                      Deployment running (build, registry push, stack deploy). This can take several minutes. Output
                      appears in <span className="font-medium">Last deployment</span> when the run finishes.
                    </span>
                  </div>
                ) : null}

                {deployLogQuery.data?.[0] ? (
                  <div className="px-5 py-3 border-b border-border/40 bg-muted/25 shrink-0 space-y-2">
                    <div className="flex flex-wrap items-baseline gap-2 justify-between gap-y-1">
                      <span className="text-xs font-semibold text-foreground">Last deployment</span>
                      <span
                        className={
                          deployLogQuery.data[0].status === "success"
                            ? "text-xs text-emerald-600 dark:text-emerald-400"
                            : deployLogQuery.data[0].status === "failed"
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                        }
                      >
                        {deployLogQuery.data[0].status === "success"
                          ? "Success"
                          : deployLogQuery.data[0].status === "failed"
                            ? "Failed"
                            : deployLogQuery.data[0].status}
                        {deployLogQuery.data[0].finishedAt ? (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            ·{" "}
                            {formatDistanceToNow(new Date(deployLogQuery.data[0].finishedAt), {
                              addSuffix: true,
                            })}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <pre className="text-[11px] font-mono text-zinc-200 whitespace-pre-wrap break-all max-h-[min(40vh,360px)] overflow-auto rounded-md bg-zinc-950/90 p-3 border border-border/50">
                      {getDeployLogText(deployLogQuery.data[0]).trim() || "—"}
                    </pre>
                  </div>
                ) : null}

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
                  ) : deploy.isPending ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground px-4 text-center">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <p className="text-sm">Waiting for the server to finish deployment…</p>
                      <p className="text-xs max-w-md text-muted-foreground/90">
                        Registry push and stack deploy run on the host. If this stays empty, check{" "}
                        <span className="text-foreground font-medium">Last deployment</span> above after the run
                        completes.
                      </p>
                    </div>
                  ) : liveLogAwaitingFirstChunk && !liveLogText ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground px-4 text-center">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <p className="text-sm">Waiting for container log lines…</p>
                      <p className="text-xs max-w-md">
                        If nothing appears, the service may not be running yet or logging may be disabled. Deploy output
                        (build / push errors) is shown under Last deployment.
                      </p>
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

function serviceVolumeRowKey(v: { composeService: string; source: string; hostVolumeName?: string }) {
  return `${v.composeService}\0${v.source}\0${v.hostVolumeName ?? ""}`;
}

function BackupImportModeToggle({
  value,
  onChange,
  disabled,
  backupLabel,
  importLabel,
}: {
  value: "backup" | "import";
  onChange: (v: "backup" | "import") => void;
  disabled?: boolean;
  backupLabel: string;
  importLabel: string;
}) {
  return (
    <div className="flex rounded-xl border border-border/60 bg-muted/20 p-1 gap-1 w-full max-w-lg">
      <button
        type="button"
        role="tab"
        aria-selected={value === "backup"}
        disabled={disabled}
        onClick={() => onChange("backup")}
        className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors inline-flex items-center justify-center gap-2 ${
          value === "backup"
            ? "bg-background/80 text-foreground shadow-sm border border-border/50"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
        }`}
      >
        <Upload className="w-4 h-4 shrink-0" />
        {backupLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "import"}
        disabled={disabled}
        onClick={() => onChange("import")}
        className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors inline-flex items-center justify-center gap-2 ${
          value === "import"
            ? "bg-background/80 text-foreground shadow-sm border border-border/50"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
        }`}
      >
        <ArrowDownToLine className="w-4 h-4 shrink-0" />
        {importLabel}
      </button>
    </div>
  );
}

function ServiceBackupPanel({
  serviceId,
  service,
  isDatabaseService,
  s3ImportSsr,
  initialS3Profiles,
}: {
  serviceId: string;
  service: Service | null;
  isDatabaseService: boolean;
  s3ImportSsr?: ServiceS3ImportSsr | null;
  initialS3Profiles?: S3ProfilePublic[];
}) {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const volumesEnabled = Boolean(service?.config) && !isDatabaseService;
  const volumesQuery = useServiceVolumes(serviceId, volumesEnabled);

  const volumeOptions = useMemo(() => {
    const items = volumesQuery.data?.items ?? [];
    return items.filter((v) => v.mountType === "volume" && v.source && v.source !== "—");
  }, [volumesQuery.data]);

  const [selectedVolumeKey, setSelectedVolumeKey] = useState<string | null>(null);

  useEffect(() => {
    if (volumeOptions.length === 0) {
      setSelectedVolumeKey(null);
      return;
    }
    setSelectedVolumeKey((prev) => {
      if (prev && volumeOptions.some((v) => serviceVolumeRowKey(v) === prev)) return prev;
      return serviceVolumeRowKey(volumeOptions[0]!);
    });
  }, [volumeOptions]);

  const selectedVolume = useMemo(() => {
    if (!selectedVolumeKey) return undefined;
    return volumeOptions.find((v) => serviceVolumeRowKey(v) === selectedVolumeKey);
  }, [volumeOptions, selectedVolumeKey]);

  const volumeBackupName = selectedVolume ? String(selectedVolume.hostVolumeName ?? selectedVolume.source).trim() : "";

  const [backupS3ProfileName, setBackupS3ProfileName] = useState("");
  const s3ProfilesQuery = useQuery({
    queryKey: ["s3-profiles"],
    queryFn: listS3ProfilesApi,
    ...(initialS3Profiles !== undefined
      ? { initialData: initialS3Profiles, refetchOnMount: false }
      : {}),
    staleTime: 60_000,
  });

  const s3Profiles = s3ProfilesQuery.data ?? [];

  useEffect(() => {
    if (backupS3ProfileName.trim()) return;
    if (s3Profiles.length === 0) return;
    setBackupS3ProfileName(s3Profiles[0]!.name);
  }, [s3Profiles, backupS3ProfileName]);

  const [dbBackup, setDbBackup] = useState<DatabaseBackupFormValues>({
    engine: "postgres",
    composeService: "",
    databaseName: "",
    dbUser: "",
    backupFormat: "postgres_sql_gzip",
  });

  useEffect(() => {
    if (!isDatabaseService || !service || service.type !== "databases") return;
    const opts = listDatabaseBackupOptions(service, service.name);
    if (opts.length > 0) setDbBackup(opts[0]!.form);
  }, [service, isDatabaseService]);

  const engineFromConfig = service ? parseDatabaseEngineFromConfig(service.config ?? "") : undefined;
  const engineMeta = engineFromConfig ? getDatabaseEngineById(engineFromConfig) : undefined;

  const [saving, setSaving] = useState(false);
  const [output, setOutput] = useState("");
  const [importDbS3, setImportDbS3] = useState<{ profileName: string; key: string } | null>(null);
  const [importVolS3, setImportVolS3] = useState<{ profileName: string; key: string } | null>(null);

  const importDbPickerOpen = searchParams.get("s3Import") === "db";
  const importVolPickerOpen = searchParams.get("s3Import") === "vol";

  const clearS3ImportQuery = () => {
    const q = new URLSearchParams(searchParams.toString());
    q.delete("s3Import");
    q.delete("s3Profile");
    q.delete("s3Prefix");
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const openS3ImportPicker = (mode: "db" | "vol") => {
    const profile = backupS3ProfileName.trim();
    if (!profile) {
      toast({
        title: "S3 destination required",
        description: "Choose a saved S3 profile first.",
        variant: "destructive",
      });
      return;
    }
    const q = new URLSearchParams(searchParams.toString());
    q.set("s3Import", mode);
    q.set("s3Profile", profile);
    q.delete("s3Prefix");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const [importDbSaving, setImportDbSaving] = useState(false);
  const [importVolSaving, setImportVolSaving] = useState(false);
  const [importOutDb, setImportOutDb] = useState("");
  const [importOutVol, setImportOutVol] = useState("");
  const [dbBackupTab, setDbBackupTab] = useState<"backup" | "import">("backup");
  const [volBackupTab, setVolBackupTab] = useState<"backup" | "import">("backup");

  const runVolumeBackup = async () => {
    const profile = backupS3ProfileName.trim();
    if (!profile) {
      toast({
        title: "S3 destination required",
        description: "Choose a saved S3 profile to upload backups.",
        variant: "destructive",
      });
      return;
    }

    const v = volumeBackupName;
    if (!v) {
      toast({
        title: "No volume selected",
        description: "This service has no named Docker volumes in compose, or volumes could not be resolved.",
        variant: "destructive",
      });
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(v)) {
      toast({
        title: "Invalid volume name",
        description: "Resolved volume name is not in the expected format.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    setOutput("");
    try {
      const r = await runServiceBackupNowApi(serviceId, {
        action: "volume_backup",
        volumeSource: v,
        backupS3ProfileName: profile,
      });
      setOutput(r.output);
      if (r.ok) toast({ title: "Backup completed", description: "Volume backup uploaded to S3." });
      else toast({ title: "Backup failed", description: r.output, variant: "destructive" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOutput(msg);
      toast({ title: "Backup failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runDatabaseBackup = async () => {
    const profile = backupS3ProfileName.trim();
    if (!profile) {
      toast({
        title: "S3 destination required",
        description: "Choose a saved S3 profile to upload backups.",
        variant: "destructive",
      });
      return;
    }

    const v = validateDatabaseBackupForm(dbBackup);
    if (!v.ok) {
      toast({ title: "Invalid backup configuration", description: v.message, variant: "destructive" });
      return;
    }

    const cfg: DatabaseBackupConfig = {
      engine: dbBackup.engine,
      composeService: dbBackup.composeService.trim(),
      backupFormat: resolveBackupFormat(dbBackup.engine, dbBackup.backupFormat),
      ...(dbBackup.engine !== "redis" ? { databaseName: dbBackup.databaseName.trim() } : {}),
      ...(dbBackup.dbUser.trim() ? { dbUser: dbBackup.dbUser.trim() } : {}),
    };

    setSaving(true);
    setOutput("");
    try {
      const r = await runServiceBackupNowApi(serviceId, {
        action: "database_backup",
        databaseBackupConfig: cfg,
        backupS3ProfileName: profile,
      });
      setOutput(r.output);
      if (r.ok) toast({ title: "Backup completed", description: "Database backup uploaded to S3." });
      else toast({ title: "Backup failed", description: r.output, variant: "destructive" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOutput(msg);
      toast({ title: "Backup failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runImportDatabase = async () => {
    const v = validateDatabaseBackupForm(dbBackup);
    if (!v.ok) {
      toast({ title: "Invalid configuration", description: v.message, variant: "destructive" });
      return;
    }
    if (!importDbS3) {
      toast({
        title: "Object required",
        description: "Choose a database dump from an S3 destination.",
        variant: "destructive",
      });
      return;
    }
    const cfg: DatabaseBackupConfig = {
      engine: dbBackup.engine,
      composeService: dbBackup.composeService.trim(),
      backupFormat: resolveBackupFormat(dbBackup.engine, dbBackup.backupFormat),
      ...(dbBackup.engine !== "redis" ? { databaseName: dbBackup.databaseName.trim() } : {}),
      ...(dbBackup.dbUser.trim() ? { dbUser: dbBackup.dbUser.trim() } : {}),
    };
    setImportDbSaving(true);
    setImportOutDb("");
    try {
      const r = await importServiceBackupFromS3Api(serviceId, {
        action: "import_database",
        backupS3ProfileName: importDbS3.profileName,
        s3Key: importDbS3.key,
        databaseBackupConfig: JSON.stringify(cfg),
      });
      setImportOutDb(r.output);
      if (r.ok) toast({ title: "Import finished", description: "See output below." });
      else toast({ title: "Import failed", description: r.output.slice(0, 400), variant: "destructive" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportOutDb(msg);
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setImportDbSaving(false);
    }
  };

  const runImportVolume = async () => {
    const vol = volumeBackupName;
    if (!vol) {
      toast({
        title: "No volume",
        description: "Select a named volume or ensure compose has volumes.",
        variant: "destructive",
      });
      return;
    }
    if (!importVolS3) {
      toast({
        title: "Object required",
        description: "Choose a .tar.gz volume backup from an S3 destination.",
        variant: "destructive",
      });
      return;
    }
    if (!importVolS3.key.toLowerCase().endsWith(".tar.gz")) {
      toast({
        title: "Invalid object",
        description: "Volume import expects a .tar.gz produced by Weehawk volume backup.",
        variant: "destructive",
      });
      return;
    }
    setImportVolSaving(true);
    setImportOutVol("");
    try {
      const r = await importServiceBackupFromS3Api(serviceId, {
        action: "import_volume",
        backupS3ProfileName: importVolS3.profileName,
        s3Key: importVolS3.key,
        volumeSource: vol,
      });
      setImportOutVol(r.output);
      if (r.ok) toast({ title: "Import finished", description: "See output below." });
      else toast({ title: "Import failed", description: r.output.slice(0, 400), variant: "destructive" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportOutVol(msg);
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setImportVolSaving(false);
    }
  };

  const serviceForDbPanel = service?.type === "databases" ? service : null;

  const s3Block = (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Backup destination (S3)</label>
      <select
        className="input-field w-full"
        value={backupS3ProfileName}
        onChange={(e) => setBackupS3ProfileName(e.target.value)}
        disabled={saving || importDbSaving || importVolSaving}
      >
        {s3Profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name} ({p.bucket})
          </option>
        ))}
      </select>
    </div>
  );

  if (s3ProfilesQuery.isPending) {
    return (
      <div className="glass-panel rounded-2xl border border-border max-w-lg mx-auto px-8 py-10 flex flex-col items-center justify-center gap-4 min-h-[200px]">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl scale-150" aria-hidden />
          <Loader2 className="relative w-8 h-8 animate-spin text-primary" aria-label="Loading S3 profiles" />
        </div>
        <p className="text-sm text-muted-foreground">Loading S3 destinations…</p>
      </div>
    );
  }

  if (s3Profiles.length === 0) {
    return (
      <div className="relative max-w-lg mx-auto">
        <div className="glass-panel rounded-2xl border border-border overflow-hidden p-8 md:p-10 text-center shadow-[0_24px_48px_-28px_rgba(0,0,0,0.45)]">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-amber-500/15 blur-[72px]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-16 right-0 h-32 w-32 rounded-full bg-sky-500/10 blur-[56px]"
            aria-hidden
          />
          <div className="relative">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 via-amber-500/5 to-sky-500/15 border border-amber-500/25 shadow-inner">
              <Cloud className="h-8 w-8 text-amber-300/90 drop-shadow-sm" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">S3 destination required</h3>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto mb-7">
              You must create an S3 destination first before you can run backups or restore from S3.
            </p>
            <Link
              href="/s3"
              className="btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-medium shadow-lg shadow-primary/15"
            >
              Open S3 destinations
              <ChevronRight className="w-4 h-4 opacity-90" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isDatabaseService) {
    return (
      <div className="glass-panel rounded-xl border border-border/60 p-10 md:p-14 text-center max-w-3xl mx-auto">
        <div className="flex items-start gap-4 flex-col md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Database className="w-12 h-12 text-muted-foreground/80" />
            <div className="text-left">
              <h2 className="text-lg font-semibold tracking-tight mb-1">Database backup &amp; restore</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Back up or restore from S3. Compose targets come from your stack; export format only on Backup to S3.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-center md:justify-start">
          <BackupImportModeToggle
            value={dbBackupTab}
            onChange={setDbBackupTab}
            disabled={saving || importDbSaving}
            backupLabel="Backup to S3"
            importLabel="Import from S3"
          />
        </div>

        <div className="mt-8 space-y-4 text-left">
          <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Database type</p>
              {engineMeta ? (
                <p className="text-sm font-medium mt-0.5">{engineMeta.name}</p>
              ) : (
                <p className="text-xs text-amber-400/90 mt-0.5">
                  Add <code className="text-[11px] bg-muted px-1 rounded"># engine: …</code> to your compose so we can
                  detect the engine.
                </p>
              )}
            </div>
            {engineMeta?.logoSrc ? (
              <div className="relative h-10 w-10 shrink-0 opacity-90">
                <Image src={engineMeta.logoSrc} alt="" fill className="object-contain" sizes="40px" />
              </div>
            ) : null}
          </div>

          {dbBackupTab === "backup" ? (
            <>
              <div className="space-y-3">
                <DatabaseBackupFormFields
                  formatOnly
                  service={serviceForDbPanel}
                  values={dbBackup}
                  onChange={(patch) => setDbBackup((prev) => ({ ...prev, ...patch }))}
                  onReplaceValues={setDbBackup}
                />
              </div>

              {s3Block}

              <div className="flex items-center gap-3 pt-2 border-t border-border/60">
                <button
                  type="button"
                  className="btn-primary flex items-center gap-2"
                  onClick={() => void runDatabaseBackup()}
                  disabled={
                    saving ||
                    importDbSaving ||
                    s3ProfilesQuery.isPending ||
                    s3Profiles.length === 0 ||
                    !dbBackup.composeService.trim()
                  }
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  {saving ? "Backing up…" : "Backup database"}
                </button>
              </div>

              {output ? (
                <pre className="mt-4 text-xs font-mono text-foreground dark:text-zinc-200 bg-muted/65 dark:bg-black/30 border border-border rounded-lg p-4 whitespace-pre-wrap break-all leading-relaxed">
                  {output}
                </pre>
              ) : null}
            </>
          ) : (
            <div className="pt-2 border-t border-border/60 space-y-4">
              <h3 className="text-sm font-semibold tracking-tight">Import database from S3</h3>
              {importDbS3 ? (
                <div className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 text-left">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-[11px] text-muted-foreground">Selected object</p>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      aria-label="Clear selection"
                      disabled={saving || importDbSaving}
                      onClick={() => setImportDbS3(null)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs font-mono text-foreground break-all">
                    <span className="text-muted-foreground">{importDbS3.profileName}</span> → {importDbS3.key}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-left">No object selected.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm inline-flex items-center gap-2"
                  disabled={saving || importDbSaving || s3Profiles.length === 0}
                  onClick={() => openS3ImportPicker("db")}
                >
                  <Cloud className="w-4 h-4" />
                  Choose from S3…
                </button>
                <button
                  type="button"
                  className="btn-primary flex items-center gap-2 text-sm"
                  onClick={() => void runImportDatabase()}
                  disabled={saving || importDbSaving || !dbBackup.composeService.trim() || !importDbS3}
                >
                  {importDbSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                  {importDbSaving ? "Importing…" : "Import database"}
                </button>
              </div>
              {importOutDb ? (
                <pre className="text-xs font-mono text-foreground dark:text-zinc-200 bg-muted/65 dark:bg-black/30 border border-border rounded-lg p-4 whitespace-pre-wrap break-all leading-relaxed">
                  {importOutDb}
                </pre>
              ) : null}
            </div>
          )}

          <S3ImportObjectPicker
            open={importDbPickerOpen}
            onOpenChange={(next) => {
              if (!next) clearS3ImportQuery();
            }}
            defaultProfileName={backupS3ProfileName}
            initialProfiles={initialS3Profiles}
            importPickerMode="db"
            ssr={
              s3ImportSsr?.mode === "db"
                ? {
                    profileName: s3ImportSsr.profileName,
                    prefix: s3ImportSsr.prefix,
                    initialList: s3ImportSsr.initialList,
                  }
                : null
            }
            title="Choose database dump"
            description="Browse your bucket and select one file compatible with this database service."
            onPick={(p) => setImportDbS3(p)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl border border-border/60 p-10 md:p-14 text-center max-w-3xl mx-auto">
      <div className="flex items-start gap-4 flex-col md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="w-12 h-12 text-muted-foreground/80" />
          <div className="text-left">
            <h2 className="text-lg font-semibold tracking-tight mb-1">Volume backup &amp; restore</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Named volumes from this service&apos;s compose are detected automatically. Back up to S3 or restore from a
              Weehawk archive already in your bucket.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-center md:justify-start">
        <BackupImportModeToggle
          value={volBackupTab}
          onChange={setVolBackupTab}
          disabled={saving || importVolSaving}
          backupLabel="Backup to S3"
          importLabel="Import from S3"
        />
      </div>

      <div className="mt-8 space-y-4 text-left">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Volume to back up</label>
          {volumesQuery.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Resolving compose volumes…
            </div>
          ) : volumesQuery.isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Could not load volumes. Check the service configuration and try again.</span>
            </div>
          ) : volumesQuery.data?.error ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90 flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{volumesQuery.data.error}</span>
            </div>
          ) : volumeOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              No named Docker volumes were found for this service. Add a <code className="text-[11px] bg-muted px-1 rounded">volumes:</code>{" "}
              entry under the service in compose, then save and try again.
            </p>
          ) : (
            <ul className="space-y-2">
              {volumeOptions.map((v) => {
                const key = serviceVolumeRowKey(v);
                const name = String(v.hostVolumeName ?? v.source);
                const selected = key === selectedVolumeKey;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setSelectedVolumeKey(key)}
                      disabled={saving || importVolSaving}
                      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                        selected
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/60 bg-muted/10 hover:bg-muted/20"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-3.5 w-3.5 rounded-full border-2 shrink-0 ${
                            selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                          }`}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium font-mono truncate">{name}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Service <span className="font-mono">{v.composeService}</span>
                            {" · "}
                            <span className="font-mono">{v.source}</span>
                            {v.target ? (
                              <>
                                {" → "}
                                <span className="font-mono">{v.target}</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <VolumeBackupDbWarning className="mt-3" />
        </div>

        {volBackupTab === "backup" ? (
          <>
            {s3Block}

            <div className="flex items-center gap-3 pt-2 border-t border-border/60">
              <button
                type="button"
                className="btn-primary flex items-center gap-2"
                onClick={() => void runVolumeBackup()}
                disabled={
                  saving ||
                  importVolSaving ||
                  s3ProfilesQuery.isPending ||
                  s3Profiles.length === 0 ||
                  !volumeBackupName ||
                  volumesQuery.isPending
                }
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                {saving ? "Backing up…" : "Backup volume"}
              </button>
            </div>

            {output ? (
              <pre className="mt-4 text-xs font-mono text-foreground dark:text-zinc-200 bg-muted/65 dark:bg-black/30 border border-border rounded-lg p-4 whitespace-pre-wrap break-all leading-relaxed">
                {output}
              </pre>
            ) : null}
          </>
        ) : (
          <div className="pt-2 border-t border-border/60 space-y-4">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Import volume from S3</h3>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Select a <code className="text-[11px] bg-muted px-1 rounded">.tar.gz</code> produced by Weehawk volume
                backup. The server downloads it from S3, then restores into the volume above (overwrites files on the host).
              </p>
            </div>
            {importVolS3 ? (
              <div className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 text-left">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-[11px] text-muted-foreground">Selected object</p>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    aria-label="Clear selection"
                    disabled={saving || importVolSaving}
                    onClick={() => setImportVolS3(null)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs font-mono text-foreground break-all">
                  <span className="text-muted-foreground">{importVolS3.profileName}</span> → {importVolS3.key}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-left">No object selected.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-secondary text-sm inline-flex items-center gap-2"
                disabled={saving || importVolSaving || !volumeBackupName || s3Profiles.length === 0}
                onClick={() => openS3ImportPicker("vol")}
              >
                <Cloud className="w-4 h-4" />
                Choose from S3…
              </button>
              <button
                type="button"
                className="btn-primary flex items-center gap-2 text-sm"
                onClick={() => void runImportVolume()}
                disabled={
                  saving ||
                  importVolSaving ||
                  !volumeBackupName ||
                  !importVolS3 ||
                  volumesQuery.isPending ||
                  volumeOptions.length === 0
                }
              >
                {importVolSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                {importVolSaving ? "Importing…" : "Import volume"}
              </button>
            </div>
            {importOutVol ? (
              <pre className="text-xs font-mono text-foreground dark:text-zinc-200 bg-muted/65 dark:bg-black/30 border border-border rounded-lg p-4 whitespace-pre-wrap break-all leading-relaxed">
                {importOutVol}
              </pre>
            ) : null}
          </div>
        )}

        <S3ImportObjectPicker
          open={importVolPickerOpen}
          onOpenChange={(next) => {
            if (!next) clearS3ImportQuery();
          }}
          defaultProfileName={backupS3ProfileName}
          initialProfiles={initialS3Profiles}
          importPickerMode="vol"
          ssr={
            s3ImportSsr?.mode === "vol"
              ? {
                  profileName: s3ImportSsr.profileName,
                  prefix: s3ImportSsr.prefix,
                  initialList: s3ImportSsr.initialList,
                }
              : null
          }
          requireTarGz
          title="Choose volume archive"
          description="Only .tar.gz objects can be selected (Weehawk volume backup format)."
          onPick={(p) => setImportVolS3(p)}
        />
      </div>
    </div>
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
  const [showInternalUrl, setShowInternalUrl] = useState(false);
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

  const internalUrl = useMemo(() => buildDatabaseInternalConnectionUrl(service), [service]);

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
    <div className="glass-panel rounded-2xl border border-sky-500/20 overflow-hidden">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-5 border-b border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight flex flex-wrap items-center gap-2">
              <Database className="w-5 h-5 text-sky-400 shrink-0" />
              <span>{getDatabaseEngineById(engine)?.name ?? "Database"}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground border border-border/80 rounded-full px-2 py-0.5">
                <Lock className="w-3 h-3" />
                Saved
              </span>
            </h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl leading-relaxed">
              Values may live in <span className="text-foreground/90">Environment</span> or{" "}
              <span className="text-foreground/90">Docker Secrets</span> (secrets are not shown). After changing replicas or
              port, redeploy the stack.
            </p>
          </div>
        </div>
      </div>

      {/* Image + stack status */}
      <div className="px-5 md:px-8 py-4 bg-muted/15 border-b border-border/60">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between gap-y-2 max-w-3xl">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Image</p>
            <p className="font-mono text-sm text-foreground break-all">{yamlImage}</p>
          </div>
          {!hasStack ? (
            <p className="text-xs text-amber-300/95 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 sm:max-w-xs shrink-0">
              No stack YAML saved yet — generate the stack from Overview to deploy.
            </p>
          ) : null}
        </div>
      </div>

      <div className="px-5 md:px-8 py-6 space-y-6">
        {/* Credentials */}
        <section aria-labelledby="db-creds-heading">
          <h4
            id="db-creds-heading"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4"
          >
            Credentials
          </h4>
          <div className="rounded-xl border border-border bg-muted/60 dark:bg-black/20 p-4 md:p-5">
            <dl className="grid gap-5 sm:grid-cols-2 text-sm">
              {hasDbName && (
                <div className="min-w-0">
                  <dt className="text-[11px] font-medium text-muted-foreground mb-1.5">Database name</dt>
                  <dd className="font-mono text-foreground break-all text-[13px] leading-snug">
                    {keys.db && env[keys.db] ? env[keys.db] : dbStoreMode === "secret" ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs font-normal">
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                        Not readable (Docker Secrets)
                      </span>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              )}
              {hasUser && (
                <div className="min-w-0">
                  <dt className="text-[11px] font-medium text-muted-foreground mb-1.5">{userLabel}</dt>
                  <dd className="font-mono text-foreground break-all text-[13px] leading-snug">
                    {keys.user && env[keys.user] ? env[keys.user] : userStoreMode === "secret" ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs font-normal">
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                        Not readable (Docker Secrets)
                      </span>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              )}
              <div className="sm:col-span-2">
                <dt className="text-[11px] font-medium text-muted-foreground mb-1.5">{primaryPasswordLabel}</dt>
                <dd className="flex items-center gap-2 flex-wrap">
                  {showPassword ? (
                    env[keys.pass] ? (
                      <span className="font-mono text-foreground break-all text-[13px]">{env[keys.pass]}</span>
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
              {rootPassKey ? (
                <div className="sm:col-span-2 pt-1 border-t border-border/60">
                  <dt className="text-[11px] font-medium text-muted-foreground mb-1.5">Root password</dt>
                  <dd className="font-mono text-foreground break-all text-[13px]">
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
              ) : null}
            </dl>
          </div>
        </section>

        {/* Scaling & host access */}
        <section aria-labelledby="db-net-heading">
          <h4
            id="db-net-heading"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4"
          >
            Scaling &amp; host access
          </h4>
          <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
            <div className="rounded-xl border border-border bg-muted/50 dark:bg-black/15 p-4">
              <p className="text-[11px] font-medium text-muted-foreground mb-2">Replicas</p>
              {!editingReplicas ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono text-lg text-foreground tabular-nums">{replicas}</span>
                  <button
                    type="button"
                    disabled={!hasStack}
                    onClick={() => {
                      setEditingReplicas(true);
                      setReplicasDraft(String(replicas));
                    }}
                    className="btn-secondary text-xs py-1.5 h-8 self-start disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
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
                    <span className="text-xs text-muted-foreground">1–10 (Swarm)</span>
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
            </div>
            <div className="rounded-xl border border-border bg-muted/50 dark:bg-black/15 p-4">
              <p className="text-[11px] font-medium text-muted-foreground mb-2">
                Host port <span className="text-muted-foreground/80 font-normal">→ container {containerPort}</span>
              </p>
              {!editingHostPort ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono text-sm">
                    {hostPort != null ? (
                      <>
                        <span className="text-emerald-400 text-lg tabular-nums">{hostPort}</span>
                        <span className="text-muted-foreground"> → {containerPort}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not published</span>
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
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
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
                    <span className="text-xs text-muted-foreground">→ {containerPort}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Empty + Save unpublishes the port on the host. Redeploy after saving.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
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
            </div>
          </div>
        </section>

        {/* Internal URL */}
        {internalUrl ? (
          <section aria-labelledby="db-internal-url-heading" className="pt-2 border-t border-border">
            <h4
              id="db-internal-url-heading"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3"
            >
              Internal connection URL
            </h4>
            <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.06] p-4 md:p-5 space-y-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed max-w-2xl">
                Same overlay network as this stack — Swarm DNS host{" "}
                <span className="font-mono text-foreground/90">{internalUrl.host}</span>.
              </p>
              {internalUrl.passwordPlaceholder ? (
                <p className="text-[11px] text-sky-900 dark:text-sky-100/85 leading-relaxed rounded-lg border border-sky-500/20 bg-muted/60 dark:bg-black/20 px-3 py-2">
                  Secrets use placeholder{" "}
                  <code className="text-[10px] font-mono bg-muted/70 dark:bg-black/35 px-1 py-0.5 rounded">{DB_URL_PASSWORD_PLACEHOLDER}</code>{" "}
                  — substitute your password when connecting, or store the password in Environment to show it in the URL
                  here.
                </p>
              ) : null}
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
                <code className="block flex-1 min-w-0 rounded-lg border border-border bg-muted/65 dark:bg-black/30 px-3 py-2.5 text-xs font-mono text-sky-900 dark:text-sky-100/90 break-all leading-relaxed">
                  {showInternalUrl ? (
                    internalUrl.displayUrl
                  ) : (
                    <span className="select-none tracking-wide text-muted-foreground">
                      {internalUrl.displayUrl.replace(/./g, "•")}
                    </span>
                  )}
                </code>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowInternalUrl((v) => !v)}
                    className="btn-secondary text-xs py-1.5 h-9 inline-flex items-center gap-1.5"
                    aria-label={showInternalUrl ? "Hide internal connection URL" : "Show internal connection URL"}
                  >
                    {showInternalUrl ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showInternalUrl ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(internalUrl.copyUrl);
                      toast({ title: "Copied", description: "Internal connection URL copied to clipboard." });
                    }}
                    className="btn-secondary text-xs py-1.5 h-9 inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
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
            className={`input-field w-full font-mono text-sm pr-10 ${!imageUnlocked ? "bg-zinc-950/80 !text-zinc-500 border-border cursor-not-allowed" : ""}`}
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
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/70"
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
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const { data: serviceRow } = useService(serviceId);
  const { data: gitSettings, isLoading: gitSettingsLoading } = useQuery({
    queryKey: ["git-settings"],
    queryFn: () => fetchGitSettings(accessToken!),
    enabled: Boolean(accessToken),
  });
  const githubIntegrationReady = useMemo(() => {
    const g = gitSettings?.github;
    if (!g) return false;
    return (
      Boolean(g.appId?.trim()) ||
      Boolean(g.clientId?.trim()) ||
      Boolean(g.clientSecretSet || g.privateKeySet)
    );
  }, [gitSettings]);
  const gitlabAccessTokenConfigured = Boolean(gitSettings?.gitlab.groupAccessTokenSet);
  /** List + clone private repos via GitHub App installation token (needs App ID + private key). */
  const githubAppListReady = Boolean(
    gitSettings?.github.appId?.trim() && gitSettings?.github.privateKeySet,
  );
  const [file, setFile] = useState<File | null>(null);
  const [buildPath, setBuildPath] = useState(".");
  const [containerPort, setContainerPort] = useState("3000");
  const [publishPort, setPublishPort] = useState("");
  const [replicas, setReplicas] = useState("1");
  const [uploading, setUploading] = useState(false);
  /** Generate stack from staged git source (POST generate-from-source). */
  const [stackGenerating, setStackGenerating] = useState(false);
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
  const [deployTarget, setDeployTarget] = useState<"source" | "image">("source");
  /** GitHub card expands clone from App installations (same flow as GitLab). */
  const [showGithubPanel, setShowGithubPanel] = useState(false);
  /** GitLab card expands clone + integration hints inline (no navigation on card click). */
  const [showGitlabPanel, setShowGitlabPanel] = useState(false);
  const [imageRef, setImageRef] = useState("");
  const [savingImage, setSavingImage] = useState(false);
  const [gitlabBranchOverride, setGitlabBranchOverride] = useState("");
  const [gitlabManualUrl, setGitlabManualUrl] = useState("");
  /** Manual URL fetch in progress (git-clone-stage). */
  const [gitlabUrlStaging, setGitlabUrlStaging] = useState(false);
  const [gitlabProjectSearchInput, setGitlabProjectSearchInput] = useState("");
  const [gitlabProjectSearchApplied, setGitlabProjectSearchApplied] = useState("");
  const [gitlabProjectsPage, setGitlabProjectsPage] = useState(1);
  const [stagingProjectId, setStagingProjectId] = useState<number | null>(null);
  /** Server has app-source from a completed git-clone-stage; user should configure options then Generate. */
  const [gitSourceStaged, setGitSourceStaged] = useState(false);
  /** Row ids that finished fetch (shows Ready). */
  const [gitlabStagedProjectIds, setGitlabStagedProjectIds] = useState<Set<number>>(() => new Set());
  /** Manual URL was fetched (shows Ready on Fetch button). */
  const [gitlabManualUrlStaged, setGitlabManualUrlStaged] = useState(false);

  const [githubBranchOverride, setGithubBranchOverride] = useState("");
  const [githubManualUrl, setGithubManualUrl] = useState("");
  const [githubUrlStaging, setGithubUrlStaging] = useState(false);
  const [githubProjectSearchInput, setGithubProjectSearchInput] = useState("");
  const [githubProjectSearchApplied, setGithubProjectSearchApplied] = useState("");
  const [githubProjectsPage, setGithubProjectsPage] = useState(1);
  /** Non-null while a GitHub repo row is fetching. */
  const [stagingGithubRepoKey, setStagingGithubRepoKey] = useState<string | null>(null);
  const [githubStagedRepoKeys, setGithubStagedRepoKeys] = useState<Set<string>>(() => new Set());
  const [githubManualUrlStaged, setGithubManualUrlStaged] = useState(false);

  const { data: gitlabProjectsData, isLoading: gitlabProjectsLoading, error: gitlabProjectsError } =
    useQuery<GitlabProjectsListResponse>({
      queryKey: [
        "gitlab-projects",
        accessToken,
        showGitlabPanel,
        Boolean(gitSettings?.gitlab.groupAccessTokenSet),
        gitlabProjectsPage,
        gitlabProjectSearchApplied,
      ],
      queryFn: () =>
        fetchGitlabProjects(accessToken!, {
          page: gitlabProjectsPage,
          perPage: 20,
          search: gitlabProjectSearchApplied.trim() || undefined,
        }),
      enabled: Boolean(
        accessToken && showGitlabPanel && gitSettings?.gitlab.groupAccessTokenSet,
      ),
    });
  const gitlabProjectsList: GitlabProjectListItem[] =
    gitlabProjectsData?.projects ?? [];

  const { data: githubReposData, isLoading: githubReposLoading, error: githubReposError } =
    useQuery<GithubRepositoriesListResponse>({
      queryKey: [
        "github-repositories",
        accessToken,
        showGithubPanel,
        githubAppListReady,
        githubProjectsPage,
        githubProjectSearchApplied,
      ],
      queryFn: () =>
        fetchGithubRepositories(accessToken!, {
          page: githubProjectsPage,
          perPage: 20,
          search: githubProjectSearchApplied.trim() || undefined,
        }),
      enabled: Boolean(accessToken && showGithubPanel && githubAppListReady),
    });
  const githubReposList: GithubRepoListItem[] = githubReposData?.repositories ?? [];

  const githubRepoRowKey = (r: GithubRepoListItem) => `${r.installation_id}\0${r.full_name}`;

  useEffect(() => {
    if (!showGitlabPanel) return;
    setGitlabProjectsPage(1);
    setGitlabProjectSearchApplied("");
    setGitlabProjectSearchInput("");
  }, [showGitlabPanel]);

  useEffect(() => {
    if (!showGithubPanel) return;
    setGithubProjectsPage(1);
    setGithubProjectSearchApplied("");
    setGithubProjectSearchInput("");
  }, [showGithubPanel]);

  useEffect(() => {
    setGitlabStagedProjectIds(new Set());
    setGitlabManualUrlStaged(false);
    setGithubStagedRepoKeys(new Set());
    setGithubManualUrlStaged(false);
    setGitSourceStaged(false);
  }, [serviceId]);

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

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    if (!cfg.includes("# weehawk application service")) {
      setDeployTarget("source");
      setImageRef("");
      return;
    }
    const dm = parseApplicationDeployMode(cfg);
    const ir = parseApplicationImageRef(cfg);
    const yamlImg = parseYamlImage(cfg);
    const app = serviceRow?.appName ?? "";
    const built = app ? `${app}:latest` : "";
    if (dm === "image") {
      setDeployTarget("image");
      setImageRef(ir ?? yamlImg ?? "");
    } else if (dm === "source") {
      setDeployTarget("source");
      setImageRef("");
    } else if (yamlImg && built && yamlImg !== built) {
      setDeployTarget("image");
      setImageRef(yamlImg);
    } else {
      setDeployTarget("source");
      setImageRef("");
    }
  }, [serviceRow?.config, serviceRow?.appName]);

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    if (!cfg.includes("# weehawk application service")) return;
    const ports = parseApplicationYamlPorts(cfg);
    if (ports) {
      setContainerPort(String(ports.containerPort));
      setPublishPort(String(ports.publishPort));
    } else {
      setPublishPort("");
    }
    const rep = parseYamlReplicas(cfg);
    if (rep != null) setReplicas(String(rep));
  }, [serviceRow?.id, serviceRow?.config]);

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
    setGitSourceStaged(false);
    setGitlabStagedProjectIds(new Set());
    setGitlabManualUrlStaged(false);
    setGithubStagedRepoKeys(new Set());
    setGithubManualUrlStaged(false);
  };

  const validateApplicationDeployForm = (): {
    cp: number;
    rp: number | undefined;
    rep: number;
    cleanVars: Array<{ key: string; value: string; store: "env" | "secret" }>;
    stk: string[];
  } | null => {
    const cleanVars = variables
      .map((v) => ({ key: v.key.trim(), value: v.value, store: v.store }))
      .filter((v) => v.key.length > 0);
    for (const v of cleanVars) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(v.key)) {
        toast({ title: "Invalid variable key", description: `Key "${v.key}" is invalid.`, variant: "destructive" });
        return null;
      }
    }
    const cp = parseInt(containerPort || "3000", 10);
    const rp = publishPort.trim() ? parseInt(publishPort.trim(), 10) : undefined;
    const rep = parseInt(replicas || "1", 10);
    if (!Number.isInteger(cp) || cp < 1 || cp > 65535) {
      toast({ title: "Invalid container port", description: "Use 1-65535.", variant: "destructive" });
      return null;
    }
    if (rp != null && (!Number.isInteger(rp) || rp < 1 || rp > 65535)) {
      toast({ title: "Invalid host port", description: "Use 1-65535 or leave empty.", variant: "destructive" });
      return null;
    }
    if (!Number.isInteger(rep) || rep < 1 || rep > 10) {
      toast({ title: "Invalid replicas", description: "Use a value between 1 and 10.", variant: "destructive" });
      return null;
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
        return null;
      }
      const low = k.toLowerCase();
      if (seen.has(low)) {
        toast({
          title: "Duplicate name",
          description: "Each extra path needs a unique name.",
          variant: "destructive",
        });
        return null;
      }
      seen.add(low);
    }
    return { cp, rp, rep, cleanVars, stk };
  };

  /** Git clone stage only — same idea as picking a ZIP: fetch source, then user sets port/env and clicks Generate. */
  const stageGitlabSource = async (opts: { gitlabProjectId?: number; httpUrlToRepo?: string }) => {
    const byProject = opts.gitlabProjectId != null && opts.gitlabProjectId > 0;
    if (!byProject) {
      const u = opts.httpUrlToRepo?.trim() ?? "";
      if (!u) {
        toast({
          title: "URL required",
          description: "Paste the HTTPS clone URL from GitLab (e.g. https://gitlab.com/group/repo.git).",
          variant: "destructive",
        });
        return;
      }
      if (!u.startsWith("http://") && !u.startsWith("https://")) {
        toast({
          title: "Invalid URL",
          description: "Use an http(s) Git clone URL.",
          variant: "destructive",
        });
        return;
      }
    }
    if (byProject) setStagingProjectId(opts.gitlabProjectId!);
    else setGitlabUrlStaging(true);
    try {
      await applicationGitCloneStageApi(serviceId, {
        gitlabProjectId: byProject ? opts.gitlabProjectId : undefined,
        httpUrlToRepo: byProject ? undefined : opts.httpUrlToRepo!.trim(),
        branch: gitlabBranchOverride.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["service", serviceId] });
      setGitSourceStaged(true);
      setGithubStagedRepoKeys(new Set());
      setGithubManualUrlStaged(false);
      if (byProject) {
        setGitlabStagedProjectIds(new Set([opts.gitlabProjectId!]));
        setGitlabManualUrlStaged(false);
      } else {
        setGitlabStagedProjectIds(new Set());
        setGitlabManualUrlStaged(true);
      }
      toast({
        title: "Repository fetched",
        description:
          "Source is on the server. Set container port, env, and networks below, then click Generate stack from source.",
      });
    } catch (e) {
      toast({
        title: "Fetch failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      if (byProject) setStagingProjectId(null);
      else setGitlabUrlStaging(false);
    }
  };

  const onGitlabFetchManualUrl = async () => {
    await stageGitlabSource({ httpUrlToRepo: gitlabManualUrl });
  };

  const onGitlabQuickFetch = (projectId: number) => {
    void stageGitlabSource({ gitlabProjectId: projectId });
  };

  const stageGithubSource = async (opts: {
    installationId?: number;
    fullName?: string;
    httpUrlToRepo?: string;
  }) => {
    const byPick =
      opts.installationId != null &&
      opts.installationId > 0 &&
      Boolean(opts.fullName?.trim());
    if (!byPick) {
      const u = opts.httpUrlToRepo?.trim() ?? "";
      if (!u) {
        toast({
          title: "URL required",
          description:
            "Paste an HTTPS clone URL from GitHub (e.g. https://github.com/org/repo.git). Public repos only unless you pick from the list below.",
          variant: "destructive",
        });
        return;
      }
      if (!u.startsWith("http://") && !u.startsWith("https://")) {
        toast({
          title: "Invalid URL",
          description: "Use an http(s) Git clone URL.",
          variant: "destructive",
        });
        return;
      }
    }
    const rowKey =
      byPick && opts.fullName
        ? `${opts.installationId}\0${opts.fullName.trim()}`
        : null;
    if (rowKey) setStagingGithubRepoKey(rowKey);
    else setGithubUrlStaging(true);
    try {
      await applicationGitCloneStageApi(serviceId, {
        githubInstallationId: byPick ? opts.installationId : undefined,
        githubRepoFullName: byPick ? opts.fullName!.trim() : undefined,
        httpUrlToRepo: byPick ? undefined : opts.httpUrlToRepo!.trim(),
        branch: githubBranchOverride.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["service", serviceId] });
      setGitSourceStaged(true);
      setGitlabStagedProjectIds(new Set());
      setGitlabManualUrlStaged(false);
      if (byPick && rowKey) {
        setGithubStagedRepoKeys(new Set([rowKey]));
        setGithubManualUrlStaged(false);
      } else {
        setGithubStagedRepoKeys(new Set());
        setGithubManualUrlStaged(true);
      }
      toast({
        title: "Repository fetched",
        description:
          "Source is on the server. Set container port, env, and networks below, then click Generate stack from source.",
      });
    } catch (e) {
      toast({
        title: "Fetch failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      if (rowKey) setStagingGithubRepoKey(null);
      else setGithubUrlStaging(false);
    }
  };

  const onGithubFetchManualUrl = async () => {
    await stageGithubSource({ httpUrlToRepo: githubManualUrl });
  };

  const onGithubQuickFetch = (installationId: number, fullName: string) => {
    void stageGithubSource({ installationId, fullName });
  };

  const generateStackFromGitSource = async () => {
    const common = validateApplicationDeployForm();
    if (!common) return;
    const { cp, rp, rep, cleanVars, stk } = common;
    setStackGenerating(true);
    try {
      await generateApplicationFromSourceApi(serviceId, {
        buildPath: buildPath.trim() || ".",
        containerPort: cp,
        publishPort: rp,
        replicas: rep,
        variables: cleanVars,
        networks: { external: connectionExternal, stack: stk },
      });
      await queryClient.invalidateQueries({ queryKey: ["service", serviceId] });
      toast({
        title: "Stack generated",
        description: "Deploy from the header to build the image and run the stack.",
      });
    } catch (e) {
      toast({
        title: "Generate failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setStackGenerating(false);
    }
  };

  /** Primary action: ZIP upload+generate, or generate from staged git source (after Fetch). */
  const onGenerateStackFromSource = async () => {
    if (file) {
      await onUpload();
      return;
    }
    if (gitSourceStaged) {
      await generateStackFromGitSource();
      return;
    }
    if (gitlabManualUrl.trim() && !gitlabManualUrlStaged) {
      toast({
        title: "Fetch repository first",
        description:
          "Click “Fetch repo” to download the source to the server, then set port and options and click Generate stack from source.",
        variant: "destructive",
      });
      return;
    }
    if (githubManualUrl.trim() && !githubManualUrlStaged) {
      toast({
        title: "Fetch repository first",
        description:
          "Click “Fetch repo” to download the GitHub source to the server (or pick a repo from the list), then click Generate stack from source.",
        variant: "destructive",
      });
      return;
    }
    if (showGitlabPanel && gitSettings?.gitlab.groupAccessTokenSet) {
      toast({
        title: "Fetch source or upload ZIP",
        description:
          "Use Fetch on a project row (or Fetch repo for a manual URL), then configure options and click Generate. Or upload a .zip file.",
        variant: "destructive",
      });
      return;
    }
    if (showGithubPanel && githubAppListReady) {
      toast({
        title: "Fetch source or upload ZIP",
        description:
          "Use Fetch on a repository row (or Fetch repo for a public GitHub HTTPS URL), then configure options and click Generate. Or upload a .zip file.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Choose a source",
      description:
        "Upload a .zip file, or open the GitHub / GitLab card and fetch a repository, or paste an HTTPS URL.",
      variant: "destructive",
    });
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
    const common = validateApplicationDeployForm();
    if (!common) return;
    const { cp, rp, rep, cleanVars, stk } = common;

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
      setGitSourceStaged(false);
      setGitlabStagedProjectIds(new Set());
      setGitlabManualUrlStaged(false);
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

  const onSaveImageStack = async () => {
    const ref = imageRef.trim();
    if (!ref.length) {
      toast({
        title: "Image required",
        description: "Enter a Docker image reference (e.g. nginx:1.27-alpine).",
        variant: "destructive",
      });
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

    setSavingImage(true);
    try {
      await patchApplicationImageDeployApi(serviceId, {
        imageRef: ref,
        containerPort: cp,
        publishPort: rp,
        replicas: rep,
        variables: cleanVars,
        networks: { external: connectionExternal, stack: stk },
      });
      await queryClient.invalidateQueries({ queryKey: ["service", serviceId] });
      toast({
        title: "Image stack saved",
        description: "Deploy to pull the image and run the stack (no source build on the host).",
      });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingImage(false);
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
        <div className="sm:col-span-2 space-y-2">
          <label className="text-xs font-medium text-muted-foreground block">Deploy from</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDeployTarget("source")}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                deployTarget === "source"
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-100"
                  : "border-border bg-muted/55 dark:bg-black/25 text-muted-foreground hover:text-foreground"
              }`}
            >
              Source code
            </button>
            <button
              type="button"
              onClick={() => setDeployTarget("image")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                deployTarget === "image"
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-100"
                  : "border-border bg-muted/55 dark:bg-black/25 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Container className="h-3.5 w-3.5 shrink-0 opacity-90" />
              Pre-built image
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/90 max-w-xl leading-relaxed">
            {deployTarget === "source"
              ? "Upload sources; Weehawk builds a Docker image on deploy using your Dockerfile or an auto-generated one."
              : "Point at an image already in a registry (or Docker Hub). Deploy pulls the image and skips building from source."}
          </p>
        </div>
        {deployTarget === "source" && (
        <div className="sm:col-span-2 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Source</label>
            <p className="text-[11px] text-muted-foreground/90 mb-2 max-w-xl">
              Register the{" "}
              <Link href="/git/github" className="text-primary hover:underline">
                GitHub App
              </Link>{" "}
              under Git → GitHub, then open the GitHub card here to list repos your app can access (installations). Same workflow as GitLab: Fetch → set port/env → Generate. Use{" "}
              <span className="text-foreground/90">Registry &amp; Git</span> in the sidebar for the full integrations list.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 sm:items-stretch">
            <button
              type="button"
              aria-expanded={showGithubPanel}
              aria-controls="github-deploy-panel"
              onClick={() => setShowGithubPanel((v) => !v)}
              className={`flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 ${
                showGithubPanel
                  ? "border-sky-500/50 bg-sky-500/10 hover:bg-sky-500/15"
                  : "border-border bg-muted/55 dark:bg-black/25 hover:border-sky-500/35 hover:bg-accent/50"
              }`}
            >
              <Image
                src="/deployment-sources/github.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
              <span className="text-xs font-medium text-foreground">GitHub</span>
              <span
                className={`text-[10px] leading-tight ${
                  githubIntegrationReady ? "text-emerald-400/90" : "text-muted-foreground"
                }`}
              >
                {gitSettingsLoading ? "…" : githubIntegrationReady ? "Configured" : "Configure"}
              </span>
              <span className="text-[9px] text-muted-foreground/80">
                {showGithubPanel ? "Hide" : "Open"} settings
              </span>
            </button>
            <button
              type="button"
              aria-expanded={showGitlabPanel}
              aria-controls="gitlab-deploy-panel"
              onClick={() => setShowGitlabPanel((v) => !v)}
              className={`flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
                showGitlabPanel
                  ? "border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/15"
                  : "border-border bg-muted/55 dark:bg-black/25 hover:border-orange-500/35 hover:bg-accent/50"
              }`}
            >
              <Image
                src="/deployment-sources/gitlab.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
              <span className="text-xs font-medium text-foreground">GitLab</span>
              <span
                className={`text-[10px] leading-tight ${
                  gitlabAccessTokenConfigured ? "text-emerald-400/90" : "text-muted-foreground"
                }`}
              >
                {gitSettingsLoading ? "…" : gitlabAccessTokenConfigured ? "Configured" : "Configure"}
              </span>
              <span className="text-[9px] text-muted-foreground/80">
                {showGitlabPanel ? "Hide" : "Open"} settings
              </span>
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
                    : "border-violet-500/35 bg-muted/65 dark:bg-black/30 hover:border-violet-500/55 hover:bg-violet-500/5"
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
                    className="absolute right-1 top-1 z-10 rounded p-1 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                    aria-label="Remove file"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {showGithubPanel ? (
          <div
            id="github-deploy-panel"
            className="rounded-xl border border-sky-500/25 bg-gradient-to-br from-sky-500/[0.07] via-transparent to-transparent p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <p className="text-xs font-medium text-foreground">GitHub — deploy from repository</p>
              <Link
                href="/git/github"
                scroll={false}
                className="inline-flex items-center gap-1 text-[11px] text-sky-300/90 hover:text-sky-200 hover:underline"
              >
                Full integration page
                <ExternalLink className="h-3 w-3 opacity-80" />
              </Link>
            </div>

            {githubAppListReady ? (
              <div className="space-y-2">
                <div>
                  <p className="text-[11px] font-medium text-foreground">Repositories your GitHub App can access</p>
                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                    Install the app on your org or user account, then refresh. Fetch downloads source to the server (like a ZIP). Then set port and env and click Generate stack from source. Search filters the merged list by full name.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 items-center max-w-xl">
                  <input
                    className="input-field font-mono text-xs flex-1 min-w-[10rem]"
                    value={githubProjectSearchInput}
                    onChange={(e) => setGithubProjectSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setGithubProjectSearchApplied(githubProjectSearchInput);
                        setGithubProjectsPage(1);
                      }
                    }}
                    placeholder="Filter by owner/repo…"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={githubReposLoading}
                    onClick={() => {
                      setGithubProjectSearchApplied(githubProjectSearchInput);
                      setGithubProjectsPage(1);
                    }}
                    className="btn-secondary inline-flex items-center gap-1.5 text-xs !py-2"
                  >
                    {githubReposLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5 opacity-80" />
                    )}
                    Search
                  </button>
                </div>
                {githubReposError ? (
                  <p className="text-[11px] text-destructive">
                    {githubReposError instanceof Error
                      ? githubReposError.message
                      : String(githubReposError)}
                  </p>
                ) : null}
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/50 bg-muted/60 dark:bg-black/20">
                  {githubReposLoading && githubReposList.length === 0 ? (
                    <li className="px-3 py-6 flex justify-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin opacity-70" />
                    </li>
                  ) : null}
                  {githubReposList.map((r) => {
                    const rk = githubRepoRowKey(r);
                    return (
                      <li
                        key={`${r.installation_id}-${r.id}`}
                        className="flex items-center gap-2 px-2.5 py-2 text-[11px]"
                      >
                        <span className="min-w-0 flex-1 font-mono truncate text-foreground/95" title={r.full_name}>
                          {r.full_name}
                        </span>
                        {r.default_branch ? (
                          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                            {r.default_branch}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            githubUrlStaging ||
                            stagingGithubRepoKey !== null ||
                            stagingProjectId !== null ||
                            gitlabUrlStaging
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            onGithubQuickFetch(r.installation_id, r.full_name);
                          }}
                          className={`inline-flex items-center justify-center gap-1 text-[10px] !py-1 !px-2.5 shrink-0 rounded-md font-medium transition-colors ${
                            githubStagedRepoKeys.has(rk) && stagingGithubRepoKey !== rk
                              ? "border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                              : "btn-secondary"
                          }`}
                        >
                          {stagingGithubRepoKey === rk ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : githubStagedRepoKeys.has(rk) ? (
                            <>
                              <CheckCircle className="h-3 w-3 opacity-90" aria-hidden />
                              Ready
                            </>
                          ) : (
                            "Fetch"
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {!githubReposLoading && githubReposList.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    No repositories found. Install the GitHub App on an account with repos, or try another search.
                  </p>
                ) : null}
                {githubReposData && githubReposData.totalPages > 1 ? (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>
                      Page {githubReposData.page} / {githubReposData.totalPages}
                    </span>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-40"
                      disabled={githubProjectsPage <= 1 || githubReposLoading}
                      onClick={() => setGithubProjectsPage((n) => Math.max(1, n - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-40"
                      disabled={
                        githubProjectsPage >= githubReposData.totalPages || githubReposLoading
                      }
                      onClick={() => setGithubProjectsPage((n) => n + 1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border bg-muted/50 dark:bg-black/15 px-3 py-2">
                Complete{" "}
                <Link href="/git/github" className="text-sky-300/90 hover:underline">
                  Git → GitHub
                </Link>{" "}
                (register the app via manifest) so the API has the App ID and private key. Until then, use a public repo HTTPS URL below (no auth).
              </p>
            )}

            <div className="flex items-start gap-2">
              <Image
                src="/deployment-sources/github.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 object-contain mt-0.5"
              />
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium text-foreground">Or paste GitHub HTTPS URL</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Public repositories only from here. Private repos must be fetched from the list above after the app is installed.
                </p>
              </div>
            </div>

            <div className="space-y-2 max-w-xl">
              <label className="text-[10px] font-medium text-muted-foreground block">HTTPS clone URL (manual)</label>
              <input
                className="input-field font-mono text-xs w-full"
                value={githubManualUrl}
                onChange={(e) => {
                  setGithubManualUrl(e.target.value);
                  setGithubManualUrlStaged(false);
                  setGitSourceStaged(false);
                }}
                placeholder="https://github.com/org/repo.git"
                autoComplete="off"
                spellCheck={false}
              />
              <div>
                <label className="text-[10px] font-medium text-muted-foreground block mb-1">Branch (optional)</label>
                <input
                  className="input-field font-mono text-xs w-full"
                  value={githubBranchOverride}
                  onChange={(e) => setGithubBranchOverride(e.target.value)}
                  placeholder="Repository default if empty"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                disabled={
                  githubUrlStaging ||
                  stagingGithubRepoKey !== null ||
                  stagingProjectId !== null ||
                  gitlabUrlStaging ||
                  !githubManualUrl.trim()
                }
                onClick={() => void onGithubFetchManualUrl()}
                className={`inline-flex items-center gap-2 text-xs !py-2 rounded-md font-medium transition-colors ${
                  githubManualUrlStaged && !githubUrlStaging
                    ? "border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 px-3"
                    : "btn-primary"
                }`}
              >
                {githubUrlStaging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : githubManualUrlStaged ? (
                  <CheckCircle className="h-3.5 w-3.5 opacity-90" aria-hidden />
                ) : null}
                {githubManualUrlStaged && !githubUrlStaging ? "Ready" : "Fetch repo"}
              </button>
            </div>
          </div>
          ) : null}

          {showGitlabPanel ? (
          <div
            id="gitlab-deploy-panel"
            className="rounded-xl border border-orange-500/25 bg-gradient-to-br from-orange-500/[0.07] via-transparent to-transparent p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <p className="text-xs font-medium text-foreground">GitLab — deploy from repository</p>
              <Link
                href="/git/gitlab"
                scroll={false}
                className="inline-flex items-center gap-1 text-[11px] text-orange-300/90 hover:text-orange-200 hover:underline"
              >
                Full integration page
                <ExternalLink className="h-3 w-3 opacity-80" />
              </Link>
            </div>

            {gitSettings?.gitlab.groupAccessTokenSet ? (
              <div className="space-y-2">
                <div>
                  <p className="text-[11px] font-medium text-foreground">Projects you can fetch</p>
                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                    Fetch downloads source to the server (like choosing a ZIP). Then set port and env and click Generate stack from source. Use Search to filter by name or path.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 items-center max-w-xl">
                  <input
                    className="input-field font-mono text-xs flex-1 min-w-[10rem]"
                    value={gitlabProjectSearchInput}
                    onChange={(e) => setGitlabProjectSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setGitlabProjectSearchApplied(gitlabProjectSearchInput);
                        setGitlabProjectsPage(1);
                      }
                    }}
                    placeholder="Filter by name or path…"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={gitlabProjectsLoading}
                    onClick={() => {
                      setGitlabProjectSearchApplied(gitlabProjectSearchInput);
                      setGitlabProjectsPage(1);
                    }}
                    className="btn-secondary inline-flex items-center gap-1.5 text-xs !py-2"
                  >
                    {gitlabProjectsLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5 opacity-80" />
                    )}
                    Search
                  </button>
                </div>
                {gitlabProjectsError ? (
                  <p className="text-[11px] text-destructive">
                    {gitlabProjectsError instanceof Error
                      ? gitlabProjectsError.message
                      : String(gitlabProjectsError)}
                  </p>
                ) : null}
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/50 bg-muted/60 dark:bg-black/20">
                  {gitlabProjectsLoading && gitlabProjectsList.length === 0 ? (
                    <li className="px-3 py-6 flex justify-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin opacity-70" />
                    </li>
                  ) : null}
                  {gitlabProjectsList.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 px-2.5 py-2 text-[11px]"
                    >
                      <span className="min-w-0 flex-1 font-mono truncate text-foreground/95" title={p.path_with_namespace}>
                        {p.path_with_namespace}
                      </span>
                      {p.default_branch ? (
                        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                          {p.default_branch}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        disabled={
                          gitlabUrlStaging ||
                          stagingProjectId !== null ||
                          githubUrlStaging ||
                          stagingGithubRepoKey !== null
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onGitlabQuickFetch(p.id);
                        }}
                        className={`inline-flex items-center justify-center gap-1 text-[10px] !py-1 !px-2.5 shrink-0 rounded-md font-medium transition-colors ${
                          gitlabStagedProjectIds.has(p.id) && stagingProjectId !== p.id
                            ? "border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                            : "btn-secondary"
                        }`}
                      >
                        {stagingProjectId === p.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : gitlabStagedProjectIds.has(p.id) ? (
                          <>
                            <CheckCircle className="h-3 w-3 opacity-90" aria-hidden />
                            Ready
                          </>
                        ) : (
                          "Fetch"
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {!gitlabProjectsLoading && gitlabProjectsList.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No projects found. Try another search or check GitLab.</p>
                ) : null}
                {gitlabProjectsData && gitlabProjectsData.totalPages > 1 ? (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>
                      Page {gitlabProjectsData.page} / {gitlabProjectsData.totalPages}
                    </span>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-40"
                      disabled={gitlabProjectsPage <= 1 || gitlabProjectsLoading}
                      onClick={() => setGitlabProjectsPage((n) => Math.max(1, n - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-40"
                      disabled={
                        gitlabProjectsPage >= gitlabProjectsData.totalPages || gitlabProjectsLoading
                      }
                      onClick={() => setGitlabProjectsPage((n) => n + 1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border bg-muted/50 dark:bg-black/15 px-3 py-2">
                Save a <strong className="text-foreground/90">personal or group access token</strong> on{" "}
                <Link href="/git/gitlab" className="text-orange-300/90 hover:underline">
                  Git → GitLab
                </Link>{" "}
                to load your projects here. Until then, use the manual HTTPS URL below (works for public repos without a token).
              </p>
            )}

            <div className="flex items-start gap-2">
              <Image
                src="/deployment-sources/gitlab.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 object-contain mt-0.5"
              />
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium text-foreground">Or paste URL manually</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  If a project does not appear in the list, or your repo is public, paste its HTTPS clone URL here.
                </p>
              </div>
            </div>

            <div className="space-y-2 max-w-xl">
              <label className="text-[10px] font-medium text-muted-foreground block">HTTPS clone URL (manual)</label>
              <input
                className="input-field font-mono text-xs w-full"
                value={gitlabManualUrl}
                onChange={(e) => {
                  setGitlabManualUrl(e.target.value);
                  setGitlabManualUrlStaged(false);
                  setGitSourceStaged(false);
                }}
                placeholder="https://gitlab.com/group/project.git"
                autoComplete="off"
                spellCheck={false}
              />
              <div>
                <label className="text-[10px] font-medium text-muted-foreground block mb-1">Branch (optional)</label>
                <input
                  className="input-field font-mono text-xs w-full"
                  value={gitlabBranchOverride}
                  onChange={(e) => setGitlabBranchOverride(e.target.value)}
                  placeholder="Repository default if empty"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                disabled={
                  gitlabUrlStaging ||
                  stagingProjectId !== null ||
                  githubUrlStaging ||
                  stagingGithubRepoKey !== null ||
                  !gitlabManualUrl.trim()
                }
                onClick={() => void onGitlabFetchManualUrl()}
                className={`inline-flex items-center gap-2 text-xs !py-2 rounded-md font-medium transition-colors ${
                  gitlabManualUrlStaged && !gitlabUrlStaging
                    ? "border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 px-3"
                    : "btn-primary"
                }`}
              >
                {gitlabUrlStaging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : gitlabManualUrlStaged ? (
                  <CheckCircle className="h-3.5 w-3.5 opacity-90" aria-hidden />
                ) : null}
                {gitlabManualUrlStaged && !gitlabUrlStaging ? "Ready" : "Fetch repo"}
              </button>
            </div>
          </div>
          ) : null}
        </div>
        )}
        {deployTarget === "image" && (
        <div className="sm:col-span-2 space-y-2">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Image reference</label>
          <input
            className="input-field font-mono text-sm w-full max-w-xl"
            value={imageRef}
            onChange={(e) => setImageRef(e.target.value)}
            placeholder="e.g. nginx:1.27-alpine or registry.example.com/my/app:v1"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground leading-relaxed max-w-xl">
            The stack uses this image as-is. Ensure the process listens on the{" "}
            <span className="text-foreground font-medium">container port</span> you set below (maps to Swarm / health expectations).
          </p>
        </div>
        )}
        {deployTarget === "source" && (
        <>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Build path</label>
          <input className="input-field font-mono text-sm" value={buildPath} onChange={(e) => setBuildPath(e.target.value)} placeholder="." />
        </div>
        <div className="sm:col-span-2 rounded-lg border border-border bg-muted/60 dark:bg-black/20 px-3 py-2.5">
          <p className="text-xs font-medium text-foreground mb-1">Dockerfile-first build</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            If your project includes a <code className="text-[10px]">Dockerfile</code> in the build path, it is used as-is.
            Otherwise Weehawk generates a multi-stage Dockerfile (Node, Go, Python, or static) inside the same context — flat{" "}
            <code className="text-[10px]">/app</code>, symlink-safe, and <code className="text-[10px]">npm ci</code> for Node.
          </p>
        </div>
        </>
        )}
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
              className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-border bg-zinc-950/30 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 [&::-webkit-details-marker]:hidden"
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
                  Keys & values — Docker Secret or env; applied when you save the stack.
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
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          {deployTarget === "source" ? (
            <button
              type="button"
              onClick={() => void onGenerateStackFromSource()}
              disabled={
                uploading ||
                stackGenerating ||
                gitlabUrlStaging ||
                stagingProjectId !== null ||
                githubUrlStaging ||
                stagingGithubRepoKey !== null
              }
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : stackGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : gitlabUrlStaging ||
                stagingProjectId !== null ||
                githubUrlStaging ||
                stagingGithubRepoKey !== null ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PackageOpen className="w-4 h-4" />
              )}
              {uploading
                ? "Uploading…"
                : stackGenerating
                  ? "Generating…"
                  : gitlabUrlStaging ||
                      stagingProjectId !== null ||
                      githubUrlStaging ||
                      stagingGithubRepoKey !== null
                    ? "Fetching…"
                    : "Generate stack from source"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onSaveImageStack()}
              disabled={savingImage}
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              {savingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Container className="w-4 h-4" />}
              {savingImage ? "Saving..." : "Save image stack"}
            </button>
          )}
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
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground flex-shrink-0">
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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-5 py-3.5 border-b border-border/60">
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
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors"
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
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors"
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
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors"
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
          className="w-full bg-zinc-100 text-zinc-900 dark:bg-black/70 dark:text-zinc-200 font-mono text-xs p-5 min-h-[320px] resize-y outline-none border-none leading-relaxed placeholder:text-muted-foreground"
          spellCheck={false}
        />
      ) : (
        <pre className="w-full bg-zinc-100 text-zinc-800 dark:bg-black/70 dark:text-zinc-300 font-mono text-xs p-5 min-h-[200px] min-w-0 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
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

function DomainsPanel({ service }: { service: Service }) {
  const { toast } = useToast();
  const saveRoutesMutation = useUpdateService();

  const seedKey = `${service.id}:${JSON.stringify(service.traefikRoutes)}:${JSON.stringify(service.domains)}`;
  const [routes, setRoutes] = useState<TraefikRouteRule[]>(() => buildInitialTraefikRoutes(service));

  useEffect(() => {
    setRoutes(buildInitialTraefikRoutes(service));
  }, [seedKey, service]);

  const saveRoutes = (next: TraefikRouteRule[]) => {
    const sanitized: TraefikRouteRule[] = [];
    for (const r of next) {
      const router = r.router.trim().toLowerCase();
      const hosts = (r.hosts ?? []).map((h) => h.trim()).filter(Boolean);
      if (!router || !/^[a-z][a-z0-9_-]*$/.test(router)) continue;
      if (!hosts.length) continue;
      let port: number | null | undefined = r.port ?? null;
      if (port !== null && port !== undefined) {
        const n = Math.floor(Number(port));
        if (!Number.isFinite(n) || n < 1 || n > 65535) port = null;
        else port = n;
      }
      let pathPrefix = r.pathPrefix?.trim() ?? null;
      if (pathPrefix === "") pathPrefix = null;
      if (pathPrefix && !pathPrefix.startsWith("/")) pathPrefix = `/${pathPrefix}`;
      sanitized.push({ router, hosts, pathPrefix, port: port ?? null });
    }

    saveRoutesMutation.mutate(
      {
        id: service.id,
        patch: {
          traefikRoutes: sanitized,
          domains: [],
        },
      },
      {
        onSuccess: () => toast({ title: "Routes saved", description: "Redeploy the stack to apply Traefik labels." }),
        onError: (e: Error) =>
          toast({ title: "Error", description: e.message, variant: "destructive" }),
      },
    );
  };

  const addRoute = () => {
    setRoutes((prev) => [
      ...prev,
      {
        router: `r${prev.length + 1}`,
        hosts: [],
        pathPrefix: null,
        port: null,
      },
    ]);
  };

  const removeRoute = (index: number) => {
    setRoutes((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRoute = (index: number, patch: Partial<TraefikRouteRule>) => {
    setRoutes((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const hostsText = (hosts: string[]) => hosts.join("\n");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">
            Traefik routes
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-2xl">
            Define router name, hostnames, optional <span className="font-mono">PathPrefix</span> (e.g.{" "}
            <span className="font-mono">/api</span>), and optional port if it differs from the app container port.
            Uses <span className="font-mono">websecure</span> and your Let&apos;s Encrypt resolver from{" "}
            <Link href="/traefik" className="text-primary hover:underline">
              More → Traefik
            </Link>
            . Attaches the <span className="font-mono">weehawk</span> overlay.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={addRoute} className="btn-secondary text-sm flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Add route
          </button>
          <button
            type="button"
            disabled={saveRoutesMutation.isPending}
            className="btn-primary text-sm"
            onClick={() => saveRoutes(routes)}
          >
            {saveRoutesMutation.isPending ? "Saving…" : "Save routes"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {routes.length === 0 && (
          <div className="glass-panel rounded-xl p-8 text-center text-sm text-muted-foreground">
            No routes. Click &quot;Add route&quot; to define Traefik labels.
          </div>
        )}
        {routes.map((route, index) => (
          <motion.div
            key={`${index}-${route.router}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-xl p-5 border border-border space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                Router{" "}
                <span className="font-mono text-xs text-muted-foreground">{route.router || `…`}</span>
              </h4>
              <button
                type="button"
                onClick={() => removeRoute(index)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Remove
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-[11px] text-muted-foreground">Router name</span>
                <input
                  className="input-field w-full font-mono text-sm"
                  placeholder="backend"
                  value={route.router}
                  onChange={(e) =>
                    updateRoute(index, { router: e.target.value.trim().toLowerCase() })
                  }
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] text-muted-foreground">Path prefix (optional)</span>
                <input
                  className="input-field w-full font-mono text-sm"
                  placeholder="/api"
                  value={route.pathPrefix ?? ""}
                  onChange={(e) => updateRoute(index, { pathPrefix: e.target.value || null })}
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-[11px] text-muted-foreground">Hostnames (one per line or comma-separated)</span>
              <textarea
                className="input-field w-full min-h-[72px] font-mono text-xs leading-relaxed"
                placeholder={"app.example.com\nwww.example.com"}
                value={hostsText(route.hosts)}
                onChange={(e) =>
                  updateRoute(index, { hosts: parseHostInput(e.target.value) })
                }
              />
            </label>

            <label className="block space-y-1.5 max-w-xs">
              <span className="text-[11px] text-muted-foreground">Container port (optional override)</span>
              <input
                type="number"
                min={1}
                max={65535}
                className="input-field w-full font-mono text-sm"
                placeholder="Default from stack"
                value={route.port ?? ""}
                onChange={(e) => {
                  const t = e.target.value.trim();
                  updateRoute(index, {
                    port: t === "" ? null : Math.floor(Number(t)),
                  });
                }}
              />
            </label>
          </motion.div>
        ))}
      </div>

    </div>
  );
}
