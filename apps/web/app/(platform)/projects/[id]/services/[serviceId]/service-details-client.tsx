"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Container, Layers, Copy, Trash2, FileCode,
  FolderKanban, CheckCircle,
  Download, Edit3, Save, X, Calendar, Plus,
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
  useServices,
  useUpdateService,
  usePatchApplicationNetworks,
  usePatchApplicationVolumes,
  usePatchApplicationEnv,
} from "@/hooks/use-services";
import { projectQueryKey, useProject } from "@/hooks/use-projects";
import { useDockerSecretsPagedWithInitialData } from "@/hooks/use-docker-secrets";
import { getDeployLogText, useDeploy, useDeployLogs } from "@/hooks/use-deploy-logs";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import type { Project, Service, TraefikRouteRule } from "@/lib/schema";
import {
  databaseLogoBlendClass,
  databaseLogoSizeClass,
  parseDatabaseEngineFromConfig,
  getDatabaseEngineById,
  defaultDatabaseImage,
  defaultDatabaseVolumePath,
  type DatabaseEngineId,
} from "@/lib/database-engines";
import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchGitSettings,
  fetchGithubBranches,
  fetchGithubRepositories,
  fetchGitlabBranches,
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
  applicationGitCloneStageApi,
  generateApplicationFromSourceApi,
  runServiceBackupNowApi,
  importServiceBackupFromS3Api,
  fetchAutoDeploySettings,
  configureAutoDeployApi,
  serviceQueryKeyId,
  type AutoDeploySettings,
} from "@/lib/services-api";
import {
  parseApplicationBuildPath,
  parseApplicationBuildMode,
  parseApplicationDeployMode,
  parseApplicationImageRef,
  parseApplicationNetworkHeaders,
  parseApplicationVolumeHeaders,
  parseApplicationStoreHeaders,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { listDatabaseBackupOptions } from "@/lib/database-backup-from-service";
import {
  resolveBackupFormat,
  validateDatabaseBackupForm,
  type DatabaseBackupConfig,
  type DatabaseBackupFormValues,
} from "@/lib/database-backup-preview";
import { buildDatabaseInternalConnectionUrl, DB_URL_PASSWORD_PLACEHOLDER } from "@/lib/database-internal-url";
import {
  listS3ProfilesApi,
  s3ProfileRouteId,
  type S3BucketListResponse,
  type S3ProfilePublic,
} from "@/lib/s3-api";
import { invalidateServiceScopedQueries } from "@/lib/invalidate-service-queries";
import { hostsFromRemoteServerDomainsJson } from "@/lib/remote-server-domains-json";
import { cn } from "@/lib/utils";
const MAX_LIVE_LOG_CHARS = 512 * 1024;

type PendingAutoDeploy = {
  enabled: boolean;
  gitProvider: "github" | "gitlab";
  repoId: string;
  branch: string;
};

function pendingAutoDeployMatchesServer(
  p: PendingAutoDeploy,
  s: AutoDeploySettings | undefined,
): boolean {
  if (!s) return false;
  return (
    p.enabled === s.autoDeployEnabled &&
    p.branch === (s.autoDeployBranch ?? "main") &&
    p.gitProvider === s.autoDeployGitProvider &&
    p.repoId === (s.autoDeployRepoId ?? "")
  );
}

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
    color: "bg-zinc-500/10 text-zinc-700 border-zinc-400/40 dark:text-zinc-300 dark:border-zinc-500/20",
    glow: "shadow-[0_0_20px_rgba(0,0,0,0.06)] dark:shadow-[0_0_24px_rgba(255,255,255,0.06)]",
    icon: Container,
    placeholder: `version: '3.8'

services:
  app:
    image: nginx:latest
    ports:
      - "80:80"
    networks:
      - app-network

networks:
  app-network:
    driver: bridge`,
  },
  stack: {
    label: "Stack",
    color: "bg-muted/70 text-zinc-800 border-zinc-300/60 dark:bg-white/5 dark:text-zinc-200 dark:border-border",
    glow: "shadow-[0_0_20px_rgba(0,0,0,0.05)] dark:shadow-[0_0_24px_rgba(255,255,255,0.05)]",
    icon: Layers,
    placeholder: `version: '3.8'

services:
  app:
    image: nginx:latest
    ports:
      - "80:80"
    deploy:
      replicas: 2
    networks:
      - overlay-net

networks:
  overlay-net:
    driver: overlay`,
  },
  application: {
    label: "Application",
    color: "bg-violet-500/10 text-violet-800 border-violet-400/45 dark:text-violet-200 dark:border-violet-500/25",
    glow: "shadow-[0_0_20px_rgba(139,92,246,0.14)] dark:shadow-[0_0_24px_rgba(139,92,246,0.10)]",
    icon: PackageOpen,
    placeholder: "",
  },
  databases: {
    label: "Databases",
    color: "bg-sky-500/10 text-sky-800 border-sky-400/45 dark:text-sky-200 dark:border-sky-500/25",
    glow: "shadow-[0_0_20px_rgba(56,189,248,0.14)] dark:shadow-[0_0_24px_rgba(56,189,248,0.08)]",
    icon: Database,
    placeholder: "",
  },
};

type Tab =
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

const YAML_INDENT = "  ";

/** Common Docker Compose file v3 + Swarm `deploy:` keys (flat list for simple prefix match). */
const COMPOSE_STACK_SUGGESTIONS: readonly string[] = [
  "- ",
  "attachable:",
  "build:",
  "cap_add:",
  "cap_drop:",
  "command:",
  "condition:",
  "configs:",
  "container_name:",
  "context:",
  "cpus:",
  "delay:",
  "depends_on:",
  "deploy:",
  "devices:",
  "dns:",
  "dockerfile:",
  "driver:",
  "endpoint_mode:",
  "entrypoint:",
  "env_file:",
  "environment:",
  "expose:",
  "external:",
  "extra_hosts:",
  "failure_action:",
  "global:",
  "healthcheck:",
  "hostname:",
  "image:",
  "init:",
  "interval:",
  "ipc:",
  "ipam:",
  "labels:",
  "limits:",
  "logging:",
  "max_attempts:",
  "max_failure_ratio:",
  "memory:",
  "mode:",
  "monitor:",
  "name:",
  "network_mode:",
  "networks:",
  "order:",
  "parallelism:",
  "pid:",
  "placement:",
  "ports:",
  "privileged:",
  "read_only:",
  "replicas:",
  "replicated:",
  "reservations:",
  "resources:",
  "restart:",
  "restart_policy:",
  "retries:",
  "rollback_config:",
  "scale:",
  "secrets:",
  "security_opt:",
  "services:",
  "start_period:",
  "stdin_open:",
  "stop_grace_period:",
  "stop_signal:",
  "sysctls:",
  "test:",
  "timeout:",
  "tmpfs:",
  "tty:",
  "ulimits:",
  "update_config:",
  "user:",
  "version:",
  "volumes:",
  "working_dir:",
]
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort((a, b) => a.localeCompare(b));

function wordPrefixAtCursor(value: string, caret: number): { wordStart: number; prefix: string } {
  const c = Math.max(0, Math.min(caret, value.length));
  const lineStart = value.lastIndexOf("\n", c - 1) + 1;
  const before = value.slice(lineStart, c);
  const m = before.match(/[^\s]*$/);
  const prefix = m ? m[0] : "";
  const wordStart = c - prefix.length;
  return { wordStart, prefix };
}

function filterComposeSuggestions(prefix: string): string[] {
  const q = prefix.trim().toLowerCase();
  const list = COMPOSE_STACK_SUGGESTIONS;
  if (!q) return [...list].slice(0, 55);
  const starts = list.filter((s) => s.toLowerCase().startsWith(q));
  const rest = list.filter((s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q));
  return [...starts, ...rest].slice(0, 45);
}

/** First list entry that extends the typed prefix — used for inline ghost + Tab completion. */
function pickGhostCompletion(prefix: string): { full: string; suffix: string } | null {
  if (prefix.length < 1) return null;
  const list = filterComposeSuggestions(prefix);
  const pl = prefix.length;
  for (const c of list) {
    if (c.length > pl && c.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { full: c, suffix: c.slice(pl) };
    }
  }
  return null;
}

function lineIndexAtPos(s: string, pos: number): number {
  const p = Math.max(0, Math.min(pos, s.length));
  let n = 0;
  for (let i = 0; i < p; i++) if (s[i] === "\n") n += 1;
  return n;
}

function lineStartOffset(s: string, lineIdx: number): number {
  const lines = s.split("\n");
  if (lineIdx <= 0) return 0;
  if (lineIdx >= lines.length) return s.length;
  let o = 0;
  for (let i = 0; i < lineIdx; i++) o += lines[i].length + 1;
  return o;
}

/** Tab / Shift+Tab on full logical lines; 2 spaces like default YAML in VS Code. */
function applyYamlTab(
  value: string,
  start: number,
  end: number,
  shift: boolean,
): { next: string; selStart: number; selEnd: number } | null {
  if (shift) {
    if (start === end) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const nl = value.indexOf("\n", lineStart);
      const lineEnd = nl === -1 ? value.length : nl;
      const lineText = value.slice(lineStart, lineEnd);
      let newLine = lineText;
      if (lineText.startsWith(YAML_INDENT)) newLine = lineText.slice(YAML_INDENT.length);
      else if (lineText.startsWith("\t")) newLine = lineText.slice(1);
      else return null;
      const removed = lineText.length - newLine.length;
      const next = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
      const caret = Math.max(lineStart, start - removed);
      return { next, selStart: caret, selEnd: caret };
    }
    const liStart = lineIndexAtPos(value, start);
    const liEnd = lineIndexAtPos(value, Math.max(0, end - 1));
    const lines = value.split("\n");
    const out = lines.map((line, i) => {
      if (i < liStart || i > liEnd) return line;
      if (line.startsWith(YAML_INDENT)) return line.slice(YAML_INDENT.length);
      if (line.startsWith("\t")) return line.slice(1);
      return line;
    });
    const next = out.join("\n");
    const selStart = lineStartOffset(next, liStart);
    const selEnd = liEnd + 1 >= out.length ? next.length : lineStartOffset(next, liEnd + 1);
    return { next, selStart, selEnd };
  }

  if (start === end) {
    const next = value.slice(0, start) + YAML_INDENT + value.slice(end);
    const pos = start + YAML_INDENT.length;
    return { next, selStart: pos, selEnd: pos };
  }
  const liStart = lineIndexAtPos(value, start);
  const liEnd = lineIndexAtPos(value, Math.max(0, end - 1));
  const lines = value.split("\n");
  const out = lines.map((line, i) => (i >= liStart && i <= liEnd ? YAML_INDENT + line : line));
  const next = out.join("\n");
  const selStart = lineStartOffset(next, liStart);
  const selEnd = liEnd + 1 >= out.length ? next.length : lineStartOffset(next, liEnd + 1);
  return { next, selStart, selEnd };
}

/** Compose / stack YAML editor: gutter stays aligned with textarea scroll (shared line height). */
function ConfigYamlTextareaWithGutter({
  value,
  onChange,
  placeholder,
  onSave,
  saveDisabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Ctrl+S / Cmd+S */
  onSave?: () => void;
  saveDisabled?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [caretPos, setCaretPos] = useState(0);
  const [scrollOff, setScrollOff] = useState({ top: 0, left: 0 });

  const lineCount = Math.max(value.split("\n").length, 1);
  const gutterDigits = Math.max(2, String(lineCount).length);

  const ghost = useMemo(() => {
    const { prefix } = wordPrefixAtCursor(value, caretPos);
    return pickGhostCompletion(prefix);
  }, [value, caretPos]);

  const syncScroll = () => {
    const g = gutterRef.current;
    const t = taRef.current;
    if (g && t) g.scrollTop = t.scrollTop;
  };

  useEffect(() => {
    syncScroll();
  }, [value]);

  const applySelection = (next: string, selStart: number, selEnd: number) => {
    onChange(next);
    queueMicrotask(() => {
      const el = taRef.current;
      if (!el) return;
      const a = Math.max(0, Math.min(selStart, next.length));
      const b = Math.max(0, Math.min(selEnd, next.length));
      el.setSelectionRange(a, b);
      el.focus();
    });
  };

  const applySuggestion = useCallback(
    (suggestion: string) => {
      const ta = taRef.current;
      const caret = ta?.selectionStart ?? 0;
      const { wordStart } = wordPrefixAtCursor(value, caret);
      const next = value.slice(0, wordStart) + suggestion + value.slice(caret);
      const pos = wordStart + suggestion.length;
      onChange(next);
      setCaretPos(pos);
      queueMicrotask(() => {
        const el = taRef.current;
        if (!el) return;
        el.setSelectionRange(pos, pos);
        el.focus();
      });
    },
    [value, onChange],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    setCaretPos(ta.selectionStart);

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!saveDisabled && onSave) onSave();
      return;
    }

    if (e.key === "Tab") {
      const { prefix } = wordPrefixAtCursor(value, ta.selectionStart);
      const g = pickGhostCompletion(prefix);
      if (g && ta.selectionStart === ta.selectionEnd && !e.shiftKey) {
        e.preventDefault();
        applySuggestion(g.full);
        return;
      }
      e.preventDefault();
      const result = applyYamlTab(value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
      if (result) applySelection(result.next, result.selStart, result.selEnd);
      return;
    }
  };

  /** Same font + fixed line-height as textarea so each gutter row matches one editor line. */
  const lineClass =
    "font-mono text-xs tabular-nums leading-[1.625rem] text-zinc-500 dark:text-zinc-500/90 select-none";

  const onEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    syncScroll();
    const t = e.currentTarget;
    setScrollOff({ top: t.scrollTop, left: t.scrollLeft });
  };

  return (
    <div className="flex min-h-[420px] items-stretch">
      <div
        ref={gutterRef}
        className="shrink-0 overflow-y-auto overflow-x-hidden border-r border-border/70 bg-zinc-200/95 dark:bg-zinc-950/75 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ width: `calc(${gutterDigits}ch + 1.75rem)` }}
        aria-hidden
      >
        <div className={`pt-2 pb-5 pr-3 pl-5 text-right ${lineClass}`}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="block h-[1.625rem] leading-[1.625rem]">
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="relative min-h-[420px] min-w-0 flex-1 bg-zinc-100 dark:bg-black/70">
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden pt-2 pb-5 pl-3 pr-5 font-mono text-xs leading-[1.625rem]"
          aria-hidden
        >
          <div
            className="inline-block w-max min-w-full whitespace-pre text-zinc-900 dark:text-emerald-200"
            style={{
              transform: `translate(${-scrollOff.left}px, ${-scrollOff.top}px)`,
            }}
          >
            {value.slice(0, caretPos)}
            {ghost ? (
              <span className="text-zinc-400/55 dark:text-zinc-500/55">{ghost.suffix}</span>
            ) : null}
            {value.slice(caretPos)}
          </div>
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            setCaretPos(e.target.selectionStart);
            onChange(e.target.value);
          }}
          onSelect={(e) => setCaretPos(e.currentTarget.selectionStart)}
          onClick={(e) => setCaretPos(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCaretPos(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onScroll={onEditorScroll}
          placeholder={placeholder}
          wrap="off"
          className="relative z-10 m-0 min-h-[420px] w-full resize-y overflow-x-auto overflow-y-auto border-0 bg-transparent pt-2 pb-5 pl-3 pr-5 font-mono text-xs leading-[1.625rem] text-transparent caret-zinc-900 outline-none ring-0 selection:bg-primary/25 selection:text-zinc-900 placeholder:text-muted-foreground dark:caret-emerald-400 dark:selection:bg-primary/30 dark:selection:text-emerald-200"
          style={{ lineHeight: "1.625rem" }}
          spellCheck={false}
          aria-autocomplete="inline"
        />
      </div>
    </div>
  );
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

/** Traefik labels use `traefik.http.routers.<name>…`; names must be unique or labels overwrite each other. */
function nextUniqueRouterDraft(service: Service, routes: TraefikRouteRule[]): string {
  const taken = new Set(
    routes.map((r) => r.router.trim().toLowerCase()).filter(Boolean),
  );
  if (routes.length === 0) {
    const base = defaultTraefikRouterName(service.appName);
    if (!taken.has(base.toLowerCase())) return base;
  }
  let n = routes.length + 1;
  let candidate = `r${n}`;
  while (taken.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `r${n}`;
  }
  return candidate;
}

/** One hostname per route (Traefik router rule). */
function parseSingleHostname(raw: string): string[] {
  const t = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  return t ? [t] : [];
}

/** Backend port Traefik forwards to (container port). 1–65535, or null = use compose default. */
function sanitizeTraefikInternalPort(p: unknown): number | null {
  if (p == null) return null;
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  const v = Math.floor(p);
  if (v < 1 || v > 65535) return null;
  return v;
}

function singleHostLabel(hosts: string[] | undefined): string {
  return (hosts?.[0] ?? "").trim();
}

/** http(s) URL to open the route in a browser (hostname + optional path prefix). */
function publicRouteOpenUrl(
  hostRaw: string,
  pathPrefix: string | null | undefined,
  useHttps = true,
): string | null {
  const host = hostRaw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  if (!host) return null;
  let path = pathPrefix?.trim() ?? "";
  if (path && !path.startsWith("/")) path = `/${path}`;
  const proto = useHttps ? "https" : "http";
  return `${proto}://${host}${path}`;
}

function buildInitialTraefikRoutes(service: Service): TraefikRouteRule[] {
  const tr = service.traefikRoutes;
  if (tr && tr.length > 0) {
    return tr.map((r) => ({
      ...r,
      hosts: r.hosts?.length ? [String(r.hosts[0]).trim()].filter(Boolean) : [],
      https: r.https === false ? false : true,
      port: sanitizeTraefikInternalPort(r.port),
    }));
  }
  if (service.domains?.length) {
    const h0 = String(service.domains[0]).trim();
    return [
      {
        router: defaultTraefikRouterName(service.appName),
        hosts: h0 ? [h0] : [],
        pathPrefix: null,
        port: null,
        https: true,
      },
    ];
  }
  return [];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export type ServiceS3ImportSsr = {
  mode: "db" | "vol";
  profileId: string;
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
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [isDeletingService, setIsDeletingService] = useState(false);
  const isDeletingServiceRef = useRef(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState("");
  const [liveLogText, setLiveLogText] = useState("");
  const [liveLogError, setLiveLogError] = useState<string | null>(null);
  /** True until the first SSE chunk for this connection (spinner); Clear does not reset this. */
  const [liveLogAwaitingFirstChunk, setLiveLogAwaitingFirstChunk] = useState(true);
  /** Live deploy stream (GET …/deploy/stream); same chunks as API host `docker` / remote SSH. */
  const [deployStreamText, setDeployStreamText] = useState("");
  const liveLogScrollRef = useRef<HTMLDivElement>(null);
  const deployLogScrollRef = useRef<HTMLDivElement>(null);

  const { data: service, isLoading } = useService(serviceId!, {
    initialData: initialService ?? undefined,
  });
  const { data: runtime, isLoading: runtimeLoading } = useServiceRuntime(serviceId, {
    initialData: initialRuntime ?? undefined,
  });
  const { data: project, isLoading: projectLoading } = useProject(projectId!, {
    initialData: initialProject ?? undefined,
    skipClientFetch: Boolean(initialProject),
    organizationPublicId: initialProject?.organizationPublicId,
  });

  useEffect(() => {
    if (initialProject && projectId) {
      qc.setQueryData(
        projectQueryKey(user?.userId, projectId, initialProject.organizationPublicId),
        initialProject,
      );
    }
  }, [initialProject, projectId, qc, user?.userId]);

  useEffect(() => {
    if (initialService && serviceId) {
      qc.setQueryData(["service", user?.userId ?? "none", serviceId], initialService);
    }
  }, [initialService, serviceId, qc, user?.userId]);

  useEffect(() => {
    if (!isLoading && !projectLoading && !isDeletingService && !isDeletingServiceRef.current && (!service || !project)) {
      router.replace("/resource-not-found");
    }
  }, [isLoading, projectLoading, isDeletingService, service, project, router]);

  const secretsRemoteId = (service ?? initialService)?.remoteServerId ?? null;
  const { data: secretsPaged } = useDockerSecretsPagedWithInitialData(secretsRemoteId, 1, "", {
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

  /** Build & deployment: send user to Remote tab to pick deploy host before upload / generate stack. */
  const openRemoteDeployHostPanel = useCallback(() => {
    setActiveTab("remote");
    window.setTimeout(() => {
      document.getElementById("remote-docker-host-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 180);
  }, []);

  const envEntryCount = countEnvEntries(service?.env ?? "");
  const typeConf = service ? (SERVICE_TYPE_CONFIG[service.type as keyof typeof SERVICE_TYPE_CONFIG] ?? SERVICE_TYPE_CONFIG["docker-compose"]) : SERVICE_TYPE_CONFIG["docker-compose"];
  const isDatabaseService = service?.type === "databases";
  const isApplicationService = service?.type === "application";
  const isDockerComposeService = service?.type === "docker-compose";
  const isStackOrComposeService = service?.type === "stack" || service?.type === "docker-compose";
  const hasDatabaseCompose = Boolean(service?.config?.includes("services:"));

  const runningOnHost = runtime?.running ?? false;
  const actionBusy = deploy.isPending || startService.isPending || shutdownService.isPending;

  const tabs = useMemo(() => {
    type TabDef = { id: Tab; label: string; icon: typeof FileCode; count?: number };
    const dbEngineForTabs =
      service?.type === "databases" ? parseDatabaseEngineFromConfig(service.config ?? "") : undefined;
    const head: TabDef[] = [
      ...(dbEngineForTabs ? [{ id: "dbdetails" as Tab, label: "Database", icon: Database }] : []),
      { id: "config", label: "Configuration", icon: FileCode },
    ];
    const appConf: TabDef = { id: "appconf", label: "Build & deployment", icon: PackageOpen };
    const tail: TabDef[] = [
      { id: "env", label: "Environment", icon: Variable, count: envEntryCount || undefined },
      { id: "remote", label: "Remote", icon: Server },
      { id: "backup", label: "Backup", icon: Archive },
      ...(!isStackOrComposeService
        ? [
            {
              id: "domain" as Tab,
              label: "Domains",
              icon: Globe,
              count: countTraefikRoutesOrDomains(service),
            },
          ]
        : []),
      { id: "secrets", label: "Secrets", icon: Shield, count: secretsPaged?.totalAll },
      { id: "logs", label: "Logs", icon: ScrollText },
      { id: "terminal", label: "Terminal", icon: Terminal },
    ];
    const allTabs: TabDef[] = isApplicationService ? [...head, appConf, ...tail] : [...head, ...tail];
    const withoutAppComposeTabs = isApplicationService
      ? allTabs.filter((t) => t.id !== "config" && t.id !== "env" && t.id !== "secrets")
      : allTabs;
    const withoutComposeSecrets = isDockerComposeService
      ? withoutAppComposeTabs.filter((t) => t.id !== "secrets")
      : withoutAppComposeTabs;
    if (!isDatabaseService) return withoutComposeSecrets;
    const withoutDomainSecrets = withoutComposeSecrets.filter(
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
    isDockerComposeService,
    hasDatabaseCompose,
    isStackOrComposeService,
    envEntryCount,
    service?.domains?.length,
    service?.traefikRoutes,
    secretsPaged?.totalAll,
    service?.type,
    service?.config,
  ]);

  useEffect(() => {
    const allowed = new Set(tabs.map((t) => t.id));
    if (!allowed.has(activeTab)) setActiveTab(tabs[0]?.id ?? "config");
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
  }, [liveLogText, deployStreamText, activeTab]);

  useEffect(() => {
    if (activeTab !== "logs") return;
    const el = deployLogScrollRef.current;
    if (!el || !deployStreamText) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [deployStreamText, activeTab]);

  // ── Config actions ──
  const handleSaveConfig = (opts?: { exitEdit?: boolean }) => {
    if (!service) return;
    if (updateService.isPending) return;
    const exitEdit = opts?.exitEdit === true;
    updateService.mutate(
      { id: serviceQueryKeyId(service), patch: { config: configDraft } },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "Configuration updated." });
          if (exitEdit) setEditingConfig(false);
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
    setDeployStreamText("");
    deploy.mutate(
      {
        serviceId: serviceQueryKeyId(service),
        serviceName: service.name,
        serviceType: service.type,
        mode,
        onStreamChunk: (chunk) => {
          setDeployStreamText((prev) => {
            const next = prev + chunk;
            return next.length > MAX_LIVE_LOG_CHARS ? next.slice(-MAX_LIVE_LOG_CHARS) : next;
          });
        },
      },
      {
        onSuccess: (log) => {
          setDeployStreamText("");
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
          setDeployStreamText("");
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
    startService.mutate(serviceQueryKeyId(service), {
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
        `This stops Docker for “${service.name}”. Your service record, YAML, and .env stay saved — deploy again when ready.`,
      confirmLabel: "Stop",
      variant: "destructive",
    });
    if (!ok) return;
    shutdownService.mutate(serviceQueryKeyId(service), {
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
    isDeletingServiceRef.current = true;
    setIsDeletingService(true);
    router.replace(`/projects/${projectId}`);
    deleteService.mutate(serviceQueryKeyId(service), {
      onSuccess: () => {
        toast({ title: "Service Deleted" });
      },
      onError: (e: Error) => {
        isDeletingServiceRef.current = false;
        setIsDeletingService(false);
        toast({ title: "Could not delete service", description: e.message, variant: "destructive" });
      },
    });
  };

  if (isDeletingService) return null;

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
    <div className="min-w-0 max-w-full">
      {/* Breadcrumb */}
      <div className="mb-6 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:mb-8 sm:text-sm">
        <Link href="/" className="shrink-0">
          <span className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground">
            <FolderKanban className="w-3.5 h-3.5" /> Projects
          </span>
        </Link>
        <span className="text-muted-foreground/35" aria-hidden>
          /
        </span>
        <Link href={`/projects/${projectId}`} className="min-w-0 max-w-[42vw] shrink sm:max-w-[12rem]">
          <span className="block cursor-pointer truncate transition-colors hover:text-foreground">
            {project?.name ?? "Project"}
          </span>
        </Link>
        <span className="text-muted-foreground/35" aria-hidden>
          /
        </span>
        <span className="min-w-0 max-w-[min(100%,12rem)] truncate font-medium text-foreground sm:max-w-xs">
          {service.name}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 md:space-y-6"
      >

        {/* ── Hero Header ── */}
        <div className={`glass-panel relative overflow-hidden rounded-2xl p-4 sm:p-6 ${typeConf.glow}`}>
          <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 bg-primary/5 blur-[80px]" />
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
            <div className="flex min-w-0 items-start gap-3 sm:gap-5">
              <div
                className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl sm:h-16 sm:w-16 ${
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
                    className={`object-contain h-auto w-auto max-h-12 max-w-[3.5rem] ${databaseLogoBlendClass(dbEngineId)} ${databaseLogoSizeClass(dbEngineId)}`}
                    sizes="64px"
                  />
                ) : (
                  <TypeIcon className="w-8 h-8" />
                )}
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2 sm:gap-2.5">
                  <h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl">{service.name}</h1>
                  <span className={`text-xs border rounded-full px-2.5 py-1 font-semibold ${typeConf.color}`}>{typeConf.label}</span>
                  {isDatabaseService ? (
                    <span
                      className="text-xs border rounded-full px-2.5 py-1 font-semibold flex items-center gap-1.5 bg-sky-500/10 text-sky-800 border-sky-400/45 dark:text-sky-300 dark:border-sky-500/25"
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
                          ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/35 dark:text-emerald-400 dark:border-emerald-500/25"
                          : "bg-zinc-500/10 text-zinc-600 border-zinc-400/35 dark:text-zinc-400 dark:border-zinc-500/20"
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

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {!isDatabaseService || hasDatabaseCompose ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleRunDocker("deploy")}
                    disabled={actionBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary transition-all hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-600/45 bg-red-600/12 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-600/22 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:bg-red-600/20 dark:text-red-400 dark:hover:bg-red-600/30 sm:w-auto"
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
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-600/40 bg-emerald-600/12 px-4 py-2.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 sm:w-auto"
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
                <p className="max-w-md rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  Fill the <span className="text-foreground font-medium">Postgres</span> form in the{" "}
                  <span className="text-foreground font-medium">Database</span> tab to save the stack YAML, then use Deploy (
                  <span className="font-mono text-[11px]">docker stack deploy</span>).
                </p>
              )}
              <button
                type="button"
                onClick={handleDelete}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 dark:border-destructive/35 dark:hover:bg-destructive/20 sm:w-auto sm:gap-0 sm:px-2.5 sm:py-2.5"
                aria-label="Delete service"
              >
                <Trash2 className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden />
                <span className="sm:sr-only">Delete service</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="w-full min-w-0 overflow-x-auto rounded-xl border border-border bg-card/50 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
          <div className="flex w-max min-w-full gap-1 p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:text-sm ${
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
        </div>

        {/* ── Tab Content ── */}
        <AnimatePresence mode="wait">

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
              <DatabaseSetupPanel
                serviceId={serviceQueryKeyId(service)}
                service={service}
                engine={dbEngineId}
              />
            </motion.div>
          )}

          {/* ── Build & deployment (Git / image); remote hosts → Remote tab ── */}
          {activeTab === "appconf" && isApplicationService && projectId && (
            <motion.div
              key="appconf"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <ApplicationArchivePanel
                serviceId={serviceQueryKeyId(service)}
                projectId={projectId}
                service={service}
                onNavigateToRemoteDeployHost={openRemoteDeployHostPanel}
              />
            </motion.div>
          )}

          {activeTab === "remote" && (
            <motion.div
              id="remote-docker-host-panel"
              key="remote"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <ServiceRemoteHostPanel
                service={service}
                organizationPublicId={project?.organizationPublicId?.trim() || null}
              />
            </motion.div>
          )}

          {/* ── CONFIGURATION ── */}
          {activeTab === "config" && (
            <motion.div key="config" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}               className="glass-panel rounded-2xl overflow-hidden">
              {/* Toolbar */}
              <div className="flex flex-col gap-3 border-b border-border/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <FileCode className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-semibold">{service.name}.yml</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${typeConf.color}`}>{typeConf.label}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {editingConfig ? (
                    <>
                      <button onClick={() => setEditingConfig(false)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors">
                        <X className="w-3.5 h-3.5" />Cancel
                      </button>
                      <button onClick={() => handleSaveConfig({ exitEdit: true })}
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
                <ConfigYamlTextareaWithGutter
                  value={configDraft}
                  onChange={setConfigDraft}
                  placeholder={typeConf.placeholder}
                  onSave={() => handleSaveConfig({ exitEdit: false })}
                  saveDisabled={updateService.isPending}
                />
              ) : service.config ? (
                <div className="bg-zinc-100 dark:bg-black/70 overflow-x-auto">
                  <table className="w-full border-collapse font-mono text-xs leading-[1.625rem]">
                    <tbody>
                      {service.config.split("\n").map((line, i) => (
                        <tr key={i} className="group/line hover:bg-accent/35 transition-colors">
                          <td
                            className="sticky left-0 z-[1] w-0 min-w-[3.25rem] max-w-[5rem] select-none border-r border-border/60 bg-zinc-200/95 py-0 pl-4 pr-3 text-right align-top tabular-nums leading-[1.625rem] text-zinc-500 dark:bg-zinc-950/80 dark:text-zinc-500"
                            title={`Line ${i + 1}`}
                          >
                            {i + 1}
                          </td>
                          <td className="min-w-0 py-0 pl-4 pr-5 align-top leading-[1.625rem] whitespace-pre">
                            {colorizeYaml(line)}
                          </td>
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
                organizationPublicId={project?.organizationPublicId?.trim() || null}
              />
            </motion.div>
          )}

          {/* ── DOMAIN ── */}
          {activeTab === "domain" && !isStackOrComposeService && (
            <motion.div key="domain" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}>
              <DomainsPanel service={service} />
            </motion.div>
          )}

          {/* ── SECRETS ── */}
          {activeTab === "secrets" && (
            <motion.div key="secrets" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }} className="space-y-4">
              <ServiceSecretsTab remoteServerId={secretsRemoteId} />
            </motion.div>
          )}

          {/* ── LOGS ── */}
          {activeTab === "logs" && (
            <motion.div key="logs" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}>
              <div className="glass-panel flex max-h-[min(88vh,760px)] min-h-[min(70vh,560px)] flex-col overflow-hidden rounded-xl border border-border/60">
                <div className="shrink-0 border-b border-border/60 px-3 pb-3 pt-4 sm:px-5 sm:pt-5">
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
                      Switch between live container output and the last deploy run.
                    </p>
                  </div>
                </div>

                <Tabs defaultValue="live" className="flex min-h-0 flex-1 flex-col">
                  <div className="flex shrink-0 flex-col gap-2 border-b border-border/40 px-3 pb-2 pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <TabsList className="h-9 w-full sm:w-auto justify-start">
                      <TabsTrigger value="live" className="text-xs sm:text-sm">
                        Live container
                      </TabsTrigger>
                      <TabsTrigger value="deploy" className="text-xs sm:text-sm gap-1.5">
                        Last deployment
                        {deployLogQuery.data?.[0]?.status === "failed" ? (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-destructive shrink-0"
                            aria-hidden
                          />
                        ) : null}
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent
                    value="live"
                    className="mt-0 flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden data-[state=inactive]:hidden"
                  >
                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-2 sm:gap-3 sm:px-5">
                      <button
                        type="button"
                        onClick={() => setLiveLogText("")}
                        className="btn-secondary flex h-8 items-center gap-1.5 py-1.5 text-xs"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(liveLogText);
                          toast({ title: "Copied", description: "Live logs copied to clipboard." });
                        }}
                        className="btn-secondary text-xs py-1.5 h-8 flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </button>
                    </div>
                    <div
                      ref={liveLogScrollRef}
                      className="min-h-[200px] flex-1 overflow-auto bg-slate-100 dark:bg-zinc-950 px-3 py-4 sm:px-5"
                    >
                      {isDatabaseService && !hasDatabaseCompose ? (
                        <p className="text-sm text-muted-foreground text-center py-16 px-4 leading-relaxed max-w-md mx-auto">
                          Save the Postgres stack in the <span className="text-foreground font-medium">Database</span> tab, then deploy. Live logs stream here once the Swarm stack is running.
                        </p>
                      ) : liveLogError ? (
                        <div className="text-sm text-destructive whitespace-pre-wrap">{liveLogError}</div>
                      ) : deploy.isPending && deployStreamText ? (
                        <pre className="text-xs font-mono text-slate-800 dark:text-zinc-200 whitespace-pre-wrap break-all leading-relaxed min-h-[4rem]">
                          {deployStreamText}
                        </pre>
                      ) : deploy.isPending ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground px-4 text-center">
                          <Loader2 className="w-8 h-8 animate-spin" />
                          <p className="text-sm">Waiting for the server to finish deployment…</p>
                          <p className="text-xs max-w-md text-muted-foreground/90">
                            Use the <span className="text-foreground font-medium">Last deployment</span> tab for build and push output when the run completes.
                          </p>
                        </div>
                      ) : liveLogAwaitingFirstChunk && !liveLogText ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground px-4 text-center">
                          <Loader2 className="w-8 h-8 animate-spin" />
                          <p className="text-sm">Waiting for container log lines…</p>
                          <p className="text-xs max-w-md">
                            If nothing appears, the service may not be running yet. Build and deploy output is under the{" "}
                            <span className="text-foreground font-medium">Last deployment</span> tab.
                          </p>
                        </div>
                      ) : (
                        <pre className="text-xs font-mono text-slate-800 dark:text-zinc-200 whitespace-pre-wrap break-all leading-relaxed min-h-[4rem]">
                          {liveLogText}
                        </pre>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="deploy"
                    className="mt-0 flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden data-[state=inactive]:hidden"
                  >
                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-2 sm:gap-3 sm:px-5">
                      <button
                        type="button"
                        onClick={() => {
                          const t =
                            deploy.isPending && deployStreamText
                              ? deployStreamText
                              : deployLogQuery.data?.[0]
                                ? getDeployLogText(deployLogQuery.data[0]).trim()
                                : "";
                          void navigator.clipboard.writeText(t);
                          toast({ title: "Copied", description: "Deployment log copied to clipboard." });
                        }}
                        disabled={!deployLogQuery.data?.[0] && !(deploy.isPending && deployStreamText)}
                        className="btn-secondary flex h-8 items-center gap-1.5 py-1.5 text-xs disabled:opacity-50"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </button>
                    </div>
                    <div
                      ref={deployLogScrollRef}
                      className="min-h-[200px] flex-1 overflow-auto bg-slate-100 dark:bg-zinc-950 px-3 py-4 sm:px-5"
                    >
                      {deploy.isPending && deployStreamText ? (
                        <>
                          <div className="flex flex-wrap items-baseline gap-2 justify-between gap-y-1 mb-3">
                            <span className="text-xs font-medium text-muted-foreground">Status</span>
                            <span className="text-xs text-amber-500/95">Running…</span>
                          </div>
                          <pre className="text-[11px] font-mono text-slate-800 dark:text-zinc-200 whitespace-pre-wrap break-all leading-relaxed min-h-[4rem]">
                            {deployStreamText}
                          </pre>
                        </>
                      ) : deployLogQuery.data?.[0] ? (
                        <>
                          <div className="flex flex-wrap items-baseline gap-2 justify-between gap-y-1 mb-3">
                            <span className="text-xs font-medium text-muted-foreground">Status</span>
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
                          <pre className="text-[11px] font-mono text-slate-800 dark:text-zinc-200 whitespace-pre-wrap break-all leading-relaxed min-h-[4rem]">
                            {getDeployLogText(deployLogQuery.data[0]).trim() || "—"}
                          </pre>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-16 px-4">
                          No deployment output yet. Deploy the service to see build and stack logs here.
                        </p>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
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
              <ServiceTerminalPanel serviceId={serviceQueryKeyId(service)} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
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
  organizationPublicId: s3OrganizationPublicIdProp,
}: {
  serviceId: string;
  service: Service | null;
  isDatabaseService: boolean;
  s3ImportSsr?: ServiceS3ImportSsr | null;
  initialS3Profiles?: S3ProfilePublic[];
  organizationPublicId?: string | null;
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
  const s3OrganizationPublicId = s3OrganizationPublicIdProp?.trim() || null;
  const s3ProfilesQuery = useQuery({
    queryKey: ["s3-profiles", s3OrganizationPublicId ?? "personal"],
    queryFn: () => listS3ProfilesApi(s3OrganizationPublicId),
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
    const selected = s3Profiles.find((p) => p.name === profile);
    const profileId = selected ? s3ProfileRouteId(selected) : "";
    if (!profileId) {
      toast({
        title: "S3 destination required",
        description: "Selected S3 profile is missing a public id.",
        variant: "destructive",
      });
      return;
    }
    const q = new URLSearchParams(searchParams.toString());
    q.set("s3Import", mode);
    q.set("s3Profile", profileId);
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
      <div className="relative w-full">
        <div className="glass-panel rounded-xl border border-border/60 overflow-hidden p-8 md:p-10 text-center">
          <div className="relative">
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
      <div className="glass-panel w-full min-w-0 rounded-2xl border border-border/60 p-5 text-left sm:p-8 md:p-10">
        <div className="max-w-3xl">
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-start">
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

          <div className="mt-6 flex justify-start">
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
                  <Image src={engineMeta.logoSrc} alt="" fill className={`object-contain ${databaseLogoSizeClass(engineMeta.id)}`} sizes="40px" />
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
                      profileId: s3ImportSsr.profileId,
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
      </div>
    );
  }

  return (
    <div className="glass-panel w-full min-w-0 rounded-2xl border border-border/60 p-5 text-left sm:p-8 md:p-10">
      <div className="max-w-3xl">
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-start">
        <div className="flex items-center gap-3">
          <HardDrive className="w-12 h-12 text-muted-foreground/80" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight mb-1">Volume backup &amp; restore</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Named volumes from this service&apos;s compose are detected automatically. Back up to S3 or restore from a
              Weehawk archive already in your bucket.
            </p>
          </div>
        </div>
        </div>

        <div className="mt-6 flex justify-start">
        <BackupImportModeToggle
          value={volBackupTab}
          onChange={setVolBackupTab}
          disabled={saving || importVolSaving}
          backupLabel="Backup to S3"
          importLabel="Import from S3"
        />
        </div>

        <div className="mt-8 space-y-4">
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
            <div className="rounded-lg border border-sky-400/35 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-200/90 flex gap-2 items-start">
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
                  profileId: s3ImportSsr.profileId,
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
    </div>
  );
}

// ─── Database setup (engine cards + one-time legacy form) ──

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
  const { user: authUser } = useAuth();
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
      await updateDatabaseStackApi(serviceQueryKeyId(service), engine, {
        publishPort: t === "" ? null : parseInt(t, 10),
      });
      await invalidateServiceScopedQueries(queryClient, serviceQueryKeyId(service), authUser?.userId ?? "none");
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
      await updateDatabaseStackApi(serviceQueryKeyId(service), engine, { replicas: n });
      await invalidateServiceScopedQueries(queryClient, serviceQueryKeyId(service), authUser?.userId ?? "none");
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
              Credentials are stored in the service <span className="text-foreground/90">Environment</span> and injected on
              deploy. After changing replicas or port, redeploy the stack.
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
              No stack YAML saved yet — generate the stack from the Database tab to deploy.
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
  const { user: authUser } = useAuth();
  const [dbName, setDbName] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [rootUser, setRootUser] = useState("");
  const [rootPass, setRootPass] = useState("");
  const [password, setPassword] = useState("");
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
        ...(volumePath.trim() ? { volumePath: volumePath.trim() } : {}),
        replicas: Math.min(10, Math.max(1, Math.floor(replicas) || 1)),
        ...(pp ? { publishPort: parseInt(pp, 10) } : {}),
        ...(img ? { image: img } : {}),
      });
      await invalidateServiceScopedQueries(queryClient, serviceId, authUser?.userId ?? "none");
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
  onNavigateToRemoteDeployHost,
}: {
  serviceId: string;
  projectId: string;
  service: Service;
  onNavigateToRemoteDeployHost: () => void;
}) {
  const queryClient = useQueryClient();
  const { accessToken, user: authUser } = useAuth();
  const { toast } = useToast();
  const { data: serviceRow } = useService(serviceId);
  const effectiveService = serviceRow ?? service;
  const hasDeployHost = useMemo(() => {
    const id = effectiveService.remoteServerId;
    return typeof id === "number" && id > 0;
  }, [effectiveService.remoteServerId]);
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
  const [buildPath, setBuildPath] = useState(".");
  const [appBuildStrategy, setAppBuildStrategy] = useState<"dockerfile" | "nixpacks">("dockerfile");
  const [replicas, setReplicas] = useState("1");
  /** Approximate progress while POST generate-from-source runs (no byte-level progress). */
  const [stackGenProgressPct, setStackGenProgressPct] = useState<number | null>(null);
  const stackGenProgressTimerRef = useRef<number | null>(null);
  /** Generate stack from staged git source (POST generate-from-source). */
  const [stackGenerating, setStackGenerating] = useState(false);
  const [variablesText, setVariablesText] = useState("");
  type AppEnvVarRow = {
    key: string;
    value: string;
    /** Legacy stack had this key only as a Swarm secret; not in service env until re-saved. */
    unreadableLegacySecret?: boolean;
  };
  const [variables, setVariables] = useState<AppEnvVarRow[]>([]);
  /** Show/hide value (default hidden). */
  const [valueVisibleByRow, setValueVisibleByRow] = useState<Record<number, boolean>>({});
  const [showEnvPaste, setShowEnvPaste] = useState(false);
  const [connectionExternal, setConnectionExternal] = useState<string[]>([]);
  const [connectionStackKeys, setConnectionStackKeys] = useState<string[]>([]);
  type AppVolumeRow = { source: string; target: string; readOnly: boolean };
  const [volumeRows, setVolumeRows] = useState<AppVolumeRow[]>([]);
  const [connectionsDirty, setConnectionsDirty] = useState(false);
  const [volumesDirty, setVolumesDirty] = useState(false);
  const [envDirty, setEnvDirty] = useState(false);
  const patchAppNetworks = usePatchApplicationNetworks();
  const patchAppVolumes = usePatchApplicationVolumes();
  const patchAppEnv = usePatchApplicationEnv();
  const setConnectionExternalAndDirty = useCallback((next: string[]) => {
    setConnectionExternal(next);
    setConnectionsDirty(true);
  }, []);
  const setConnectionStackKeysAndDirty = useCallback((next: string[]) => {
    setConnectionStackKeys(next);
    setConnectionsDirty(true);
  }, []);
  const [openAppSection, setOpenAppSection] = useState<"connections" | "volumes" | "env" | null>(null);
  const [deployTarget, setDeployTarget] = useState<"source" | "image">("source");
  /** Only one of GitHub / GitLab deploy panels open at a time (accordion). */
  const [gitRepoDeployPanel, setGitRepoDeployPanel] = useState<"github" | "gitlab" | null>(null);
  const showGithubPanel = gitRepoDeployPanel === "github";
  const showGitlabPanel = gitRepoDeployPanel === "gitlab";
  const [imageRef, setImageRef] = useState("");
  const [savingImage, setSavingImage] = useState(false);

  const autoDeployQ = useQuery({
    queryKey: ["auto-deploy", serviceId],
    queryFn: () => fetchAutoDeploySettings(serviceId),
    enabled: Boolean(accessToken),
  });
  /** Until Generate stack runs, only UI state; then we POST /auto-deploy (webhook registration). */
  const [pendingAutoDeploy, setPendingAutoDeploy] = useState<PendingAutoDeploy | null>(null);
  const [autoDeploySaving, setAutoDeploySaving] = useState(false);

  const effectiveAutoDeploy = useMemo(() => {
    if (pendingAutoDeploy) return pendingAutoDeploy;
    const s = autoDeployQ.data;
    if (!s) return null;
    return {
      enabled: s.autoDeployEnabled,
      gitProvider: s.autoDeployGitProvider as "github" | "gitlab" | null,
      repoId: s.autoDeployRepoId ?? "",
      branch: s.autoDeployBranch ?? "main",
    };
  }, [pendingAutoDeploy, autoDeployQ.data]);

  const [gitlabBranchOverride, setGitlabBranchOverride] = useState("");
  const [gitlabManualUrl, setGitlabManualUrl] = useState("");
  /** Manual URL fetch in progress (git-clone-stage). */
  const [gitlabUrlStaging, setGitlabUrlStaging] = useState(false);
  const [gitlabProjectSearchInput, setGitlabProjectSearchInput] = useState("");
  const [gitlabProjectSearchApplied, setGitlabProjectSearchApplied] = useState("");
  const [gitlabProjectsPage, setGitlabProjectsPage] = useState(1);
  const [stagingProjectId, setStagingProjectId] = useState<number | null>(null);
  /** Git binding stored after git-clone-stage; user should configure options then Generate. */
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
  const [gitlabBranchByProjectId, setGitlabBranchByProjectId] = useState<Record<number, string>>(
    () => ({}),
  );
  const [githubBranchByRepoKey, setGithubBranchByRepoKey] = useState<Record<string, string>>(
    () => ({}),
  );
  const [gitlabBranchPickerProjectId, setGitlabBranchPickerProjectId] = useState<number | null>(
    null,
  );
  const [githubBranchPickerKey, setGithubBranchPickerKey] = useState<string | null>(null);
  /** null = use default (open when integration not configured, closed when configured). */
  const [githubManualSectionOpen, setGithubManualSectionOpen] = useState<boolean | null>(null);
  const [gitlabManualSectionOpen, setGitlabManualSectionOpen] = useState<boolean | null>(null);

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

  const gitlabRowLabelBranch = (p: GitlabProjectListItem) => {
    const o = gitlabBranchByProjectId[p.id]?.trim();
    if (o) return o;
    return p.default_branch?.trim() || "main";
  };
  const gitlabQuickFetchBranch = (projectId: number): string | undefined => {
    const o = gitlabBranchByProjectId[projectId]?.trim();
    if (o) return o;
    const g = gitlabBranchOverride.trim();
    return g || undefined;
  };
  const githubRowLabelBranch = (r: GithubRepoListItem) => {
    const rk = githubRepoRowKey(r);
    const o = githubBranchByRepoKey[rk]?.trim();
    if (o) return o;
    return r.default_branch?.trim() || "main";
  };
  const githubQuickFetchBranch = (r: GithubRepoListItem): string | undefined => {
    const rk = githubRepoRowKey(r);
    const o = githubBranchByRepoKey[rk]?.trim();
    if (o) return o;
    const g = githubBranchOverride.trim();
    return g || undefined;
  };

  const githubBranchPickerParts = useMemo(() => {
    if (!githubBranchPickerKey) return null;
    const idx = githubBranchPickerKey.indexOf("\0");
    if (idx <= 0) return null;
    const installationId = Number(githubBranchPickerKey.slice(0, idx));
    const fullName = githubBranchPickerKey.slice(idx + 1).trim();
    if (!Number.isFinite(installationId) || installationId <= 0 || !fullName) return null;
    return { installationId, fullName, rowKey: githubBranchPickerKey };
  }, [githubBranchPickerKey]);

  const gitlabBranchesQ = useQuery({
    queryKey: ["gitlab-branches", accessToken, gitlabBranchPickerProjectId],
    queryFn: () => fetchGitlabBranches(accessToken!, gitlabBranchPickerProjectId!),
    enabled: Boolean(
      accessToken &&
        showGitlabPanel &&
        gitlabBranchPickerProjectId != null &&
        gitSettings?.gitlab.groupAccessTokenSet,
    ),
  });
  const githubBranchesQ = useQuery({
    queryKey: [
      "github-branches",
      accessToken,
      githubBranchPickerParts?.installationId,
      githubBranchPickerParts?.fullName,
    ],
    queryFn: () =>
      fetchGithubBranches(accessToken!, {
        installationId: githubBranchPickerParts!.installationId,
        repo: githubBranchPickerParts!.fullName,
      }),
    enabled: Boolean(accessToken && showGithubPanel && githubAppListReady && githubBranchPickerParts),
  });

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
    if (!showGithubPanel) setGithubManualSectionOpen(null);
  }, [showGithubPanel]);

  useEffect(() => {
    if (!showGitlabPanel) setGitlabManualSectionOpen(null);
  }, [showGitlabPanel]);

  useEffect(() => {
    setGitlabStagedProjectIds(new Set());
    setGitlabManualUrlStaged(false);
    setGithubStagedRepoKeys(new Set());
    setGithubManualUrlStaged(false);
    setGitSourceStaged(false);
    setPendingAutoDeploy(null);
  }, [serviceId]);

  useEffect(() => {
    return () => {
      if (stackGenProgressTimerRef.current != null) {
        clearInterval(stackGenProgressTimerRef.current);
        stackGenProgressTimerRef.current = null;
      }
    };
  }, []);

  const filledEnvVarCount = useMemo(
    () => variables.filter((v) => v.key.trim()).length,
    [variables],
  );
  const filledVolumeCount = useMemo(
    () => volumeRows.filter((v) => v.source.trim() && v.target.trim()).length,
    [volumeRows],
  );

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    const p = parseApplicationNetworkHeaders(cfg);
    setConnectionExternal(p.external);
    setConnectionStackKeys(p.stack.length ? p.stack : []);
    setConnectionsDirty(false);
  }, [serviceRow?.id, serviceRow?.config]);

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    const parsed = parseApplicationVolumeHeaders(cfg);
    setVolumeRows(parsed);
    setVolumesDirty(false);
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
        value: envMap[key] ?? "",
        unreadableLegacySecret:
          stores[key] === "secret" && !(envMap[key] ?? "").trim(),
      })),
    );
    setValueVisibleByRow({});
    setEnvDirty(false);
  }, [serviceRow?.id, serviceRow?.config, serviceRow?.env]);

  useEffect(() => {
    if (!serviceRow?.id || !connectionsDirty) return;
    const timer = window.setTimeout(() => {
      void patchAppNetworks
        .mutateAsync({
          id: serviceId,
          external: connectionExternal,
          stack: connectionStackKeys,
        })
        .then(() => setConnectionsDirty(false))
        .catch(() => {
          /* keep dirty for retry on next change */
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    connectionExternal,
    connectionStackKeys,
    connectionsDirty,
    patchAppNetworks,
    serviceId,
    serviceRow?.id,
  ]);

  useEffect(() => {
    if (!serviceRow?.id || !volumesDirty) return;
    const timer = window.setTimeout(() => {
      void patchAppVolumes
        .mutateAsync({
          id: serviceId,
          volumes: volumeRows.map((v) => ({
            source: v.source,
            target: v.target,
            readOnly: v.readOnly,
          })),
        })
        .then(() => setVolumesDirty(false))
        .catch(() => {
          /* keep dirty for retry on next change */
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [patchAppVolumes, serviceId, serviceRow?.id, volumeRows, volumesDirty]);

  useEffect(() => {
    if (!serviceRow?.id || !envDirty) return;
    const timer = window.setTimeout(() => {
      const cleanVars = variables
        .map((v) => ({ key: v.key.trim(), value: v.value }))
        .filter((v) => v.key.length > 0);
      void patchAppEnv
        .mutateAsync({
          id: serviceId,
          variables: cleanVars,
        })
        .then(() => setEnvDirty(false))
        .catch(() => {
          /* keep dirty for retry on next change */
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [envDirty, patchAppEnv, serviceId, serviceRow?.id, variables]);

  useEffect(() => {
    const cfg = serviceRow?.config ?? "";
    if (!cfg.includes("# weehawk application service")) {
      setAppBuildStrategy("dockerfile");
      return;
    }
    const savedPath = parseApplicationBuildPath(cfg);
    if (savedPath) setBuildPath(savedPath);
    const savedMode = parseApplicationBuildMode(cfg);
    if (savedMode) setAppBuildStrategy(savedMode);
  }, [serviceRow?.id, serviceRow?.config]);

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
    const rep = parseYamlReplicas(cfg);
    if (rep != null) setReplicas(String(rep));
  }, [serviceRow?.id, serviceRow?.config]);

  const updateVariable = (idx: number, patch: Partial<AppEnvVarRow>) => {
    setEnvDirty(true);
    setVariables((prev) =>
      prev.map((v, i) => {
        if (i !== idx) return v;
        const next = { ...v, ...patch };
        if (patch.value !== undefined && patch.value.trim() !== "") {
          next.unreadableLegacySecret = false;
        }
        return next;
      }),
    );
  };
  const addVariable = () => {
    setEnvDirty(true);
    setVariables((prev) => [...prev, { key: "", value: "" }]);
  };
  const removeVariable = (idx: number) => {
    setEnvDirty(true);
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
      parsed.push({ key, value });
    }
    setVariables(parsed);
    setEnvDirty(true);
    setValueVisibleByRow({});
    toast({
      title: "Variables loaded",
      description: `${parsed.length} variable(s) parsed. Values are saved to the service environment.`,
    });
  };

  const validateApplicationDeployForm = (): {
    cp: number;
    rp: number | undefined;
    rep: number;
    cleanVars: Array<{ key: string; value: string }>;
    stk: string[];
    volumes: Array<{ source: string; target: string; readOnly: boolean }>;
  } | null => {
    const cleanVars = variables
      .map((v) => ({ key: v.key.trim(), value: v.value }))
      .filter((v) => v.key.length > 0);
    for (const v of cleanVars) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(v.key)) {
        toast({ title: "Invalid variable key", description: `Key "${v.key}" is invalid.`, variant: "destructive" });
        return null;
      }
    }
    const cp = 3000;
    const rp: number | undefined = undefined;
    const rep = parseInt(replicas || "1", 10);
    if (!Number.isInteger(rep) || rep < 1 || rep > 10) {
      toast({ title: "Invalid replicas", description: "Use a value between 1 and 10.", variant: "destructive" });
      return null;
    }

    const stk = connectionStackKeys.map((k) => k.trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const k of stk) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,62}$/.test(k)) {
        toast({
          title: "Invalid overlay network name",
          description: "Use letters and numbers; start with a letter.",
          variant: "destructive",
        });
        return null;
      }
      const low = k.toLowerCase();
      if (seen.has(low)) {
        toast({
          title: "Duplicate name",
          description: "Each overlay network name must be unique.",
          variant: "destructive",
        });
        return null;
      }
      seen.add(low);
    }
    const volumes = volumeRows
      .map((v) => ({
        source: v.source.trim(),
        target: v.target.trim(),
        readOnly: Boolean(v.readOnly),
      }))
      .filter((v) => v.source || v.target);
    const seenTargets = new Set<string>();
    for (const v of volumes) {
      if (!v.source || !v.target) {
        toast({
          title: "Incomplete volume mapping",
          description: "Each volume row needs both source and target path.",
          variant: "destructive",
        });
        return null;
      }
      if (!v.target.startsWith("/")) {
        toast({
          title: "Invalid volume target",
          description: "Target path must start with / inside the container.",
          variant: "destructive",
        });
        return null;
      }
      const t = v.target.toLowerCase();
      if (seenTargets.has(t)) {
        toast({
          title: "Duplicate volume target",
          description: `Target "${v.target}" is used more than once.`,
          variant: "destructive",
        });
        return null;
      }
      seenTargets.add(t);
    }
    return { cp, rp, rep, cleanVars, stk, volumes };
  };

  /** Git stage: resolve binding on the API, then user sets port/env and clicks Generate. */
  const stageGitlabSource = async (opts: {
    gitlabProjectId?: number;
    httpUrlToRepo?: string;
    branch?: string;
  }) => {
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
    const branchResolved =
      opts.branch !== undefined ? opts.branch : gitlabBranchOverride;
    try {
      await applicationGitCloneStageApi(serviceId, {
        gitlabProjectId: byProject ? opts.gitlabProjectId : undefined,
        httpUrlToRepo: byProject ? undefined : opts.httpUrlToRepo!.trim(),
        branch: branchResolved.trim() || undefined,
      });
      await invalidateServiceScopedQueries(queryClient, serviceId, authUser?.userId ?? "none");
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
          "Source is on the server. Set env and networks below, then click Generate stack from source.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isRateLimit = /rate limit|too many times|too many requests|429/i.test(msg);
      toast({
        title: isRateLimit ? "GitLab rate limit" : "Fetch failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      if (byProject) setStagingProjectId(null);
      else setGitlabUrlStaging(false);
    }
  };

  const queueAutoDeployToggle = (
    newEnabled: boolean,
    provider: "github" | "gitlab",
    repoId: string,
    branch: string,
  ) => {
    setPendingAutoDeploy({
      enabled: newEnabled,
      gitProvider: provider,
      repoId,
      branch: branch.trim() || "main",
    });
  };

  const onGitlabFetchManualUrl = async () => {
    await stageGitlabSource({ httpUrlToRepo: gitlabManualUrl });
  };

  const onGitlabQuickFetch = (projectId: number) => {
    void stageGitlabSource({
      gitlabProjectId: projectId,
      branch: gitlabQuickFetchBranch(projectId),
    });
  };

  const stageGithubSource = async (opts: {
    installationId?: number;
    fullName?: string;
    httpUrlToRepo?: string;
    branch?: string;
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
    const branchResolved =
      opts.branch !== undefined ? opts.branch : githubBranchOverride;
    try {
      await applicationGitCloneStageApi(serviceId, {
        githubInstallationId: byPick ? opts.installationId : undefined,
        githubRepoFullName: byPick ? opts.fullName!.trim() : undefined,
        httpUrlToRepo: byPick ? undefined : opts.httpUrlToRepo!.trim(),
        branch: branchResolved.trim() || undefined,
      });
      await invalidateServiceScopedQueries(queryClient, serviceId, authUser?.userId ?? "none");
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
          "Source is on the server. Set env and networks below, then click Generate stack from source.",
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

  const onGithubQuickFetch = (r: GithubRepoListItem) => {
    void stageGithubSource({
      installationId: r.installation_id,
      fullName: r.full_name,
      branch: githubQuickFetchBranch(r),
    });
  };

  const generateStackFromGitSource = async () => {
    const common = validateApplicationDeployForm();
    if (!common) return;
    if (!hasDeployHost) {
      toast({
        title: "Choose a deploy host first",
        description:
          "Open the Remote tab, select a remote Docker host, and click Save. Then generate the stack so compose and source mirror to that server.",
        variant: "destructive",
      });
      onNavigateToRemoteDeployHost();
      return;
    }
    const { cp, rp, rep, cleanVars, stk, volumes } = common;
    setStackGenerating(true);
    setStackGenProgressPct(5);
    if (stackGenProgressTimerRef.current != null) {
      clearInterval(stackGenProgressTimerRef.current);
    }
    stackGenProgressTimerRef.current = window.setInterval(() => {
      setStackGenProgressPct((p) => {
        const n = p ?? 0;
        return n >= 88 ? 88 : n + 2 + Math.floor(Math.random() * 5);
      });
    }, 400);
    const pendingAd = pendingAutoDeploy;
    const serverAdSnapshot = autoDeployQ.data;
    try {
      const { remoteMirror } = await generateApplicationFromSourceApi(serviceId, {
        buildPath: buildPath.trim() || ".",
        buildMode: appBuildStrategy,
        containerPort: cp,
        publishPort: rp,
        replicas: rep,
        variables: cleanVars,
        networks: { external: connectionExternal, stack: stk },
        volumes,
      });
      await invalidateServiceScopedQueries(queryClient, serviceId, authUser?.userId ?? "none");
      if (pendingAd != null) {
        if (pendingAutoDeployMatchesServer(pendingAd, serverAdSnapshot)) {
          setPendingAutoDeploy(null);
        } else {
          setAutoDeploySaving(true);
          try {
            await configureAutoDeployApi(serviceId, {
              enabled: pendingAd.enabled,
              branch: pendingAd.branch,
              gitProvider: pendingAd.gitProvider,
              repoId: pendingAd.repoId,
            });
            await queryClient.invalidateQueries({ queryKey: ["auto-deploy", serviceId] });
            setPendingAutoDeploy(null);
            toast({
              title: pendingAd.enabled ? "Auto-deploy enabled" : "Auto-deploy disabled",
              description: pendingAd.enabled
                ? `Webhook registered; pushes to ${pendingAd.branch} will redeploy.`
                : "Provider webhook removed for this service.",
            });
          } catch (e) {
            toast({
              title: "Auto-deploy not saved",
              description: (e as Error).message,
              variant: "destructive",
            });
          } finally {
            setAutoDeploySaving(false);
          }
        }
      }
      const syncDesc =
        remoteMirror?.status === "synced"
          ? "Compose and app source were pushed to the deploy server — on-host webhooks can run without this PC."
          : remoteMirror?.status === "skipped"
            ? "Stack saved on this machine only — no deploy host was selected. Choose a host on the Remote tab and Save, then generate again to mirror."
            : remoteMirror?.status === "failed"
              ? `Stack saved locally; sync to deploy server failed: ${remoteMirror.message}`
              : "Deploy from the header to build the image and run the stack.";
      toast({
        title: "Stack generated",
        description: syncDesc,
        variant: remoteMirror?.status === "failed" ? "destructive" : "default",
      });
    } catch (e) {
      toast({
        title: "Generate failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      if (stackGenProgressTimerRef.current != null) {
        clearInterval(stackGenProgressTimerRef.current);
        stackGenProgressTimerRef.current = null;
      }
      setStackGenProgressPct(100);
      window.setTimeout(() => setStackGenProgressPct(null), 700);
      setStackGenerating(false);
    }
  };

  /** Primary action: generate from staged git source (after Fetch). */
  const onGenerateStackFromSource = async () => {
    if (gitSourceStaged) {
      await generateStackFromGitSource();
      return;
    }
    if (gitlabManualUrl.trim() && !gitlabManualUrlStaged) {
      toast({
        title: "Fetch repository first",
        description:
          "Click “Fetch repo” to link the repository (no source files on the API), then configure options and click Generate stack from source.",
        variant: "destructive",
      });
      return;
    }
    if (githubManualUrl.trim() && !githubManualUrlStaged) {
      toast({
        title: "Fetch repository first",
        description:
          "Click “Fetch repo” to link the GitHub repository (or pick a repo from the list), then click Generate stack from source.",
        variant: "destructive",
      });
      return;
    }
    if (showGitlabPanel && gitSettings?.gitlab.groupAccessTokenSet) {
      toast({
        title: "Fetch source first",
        description:
          "Use Fetch on a project row (or Fetch repo for a manual URL), then configure options and click Generate.",
        variant: "destructive",
      });
      return;
    }
    if (showGithubPanel && githubAppListReady) {
      toast({
        title: "Fetch source first",
        description:
          "Use Fetch on a repository row (or Fetch repo for a public GitHub HTTPS URL), then configure options and click Generate.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Choose a source",
      description: "Open the GitHub or GitLab card and fetch a repository, or paste an HTTPS clone URL.",
      variant: "destructive",
    });
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
    const common = validateApplicationDeployForm();
    if (!common) return;
    const { cp, rp, rep, cleanVars, stk, volumes } = common;

    setSavingImage(true);
    try {
      await patchApplicationImageDeployApi(serviceId, {
        imageRef: ref,
        containerPort: cp,
        publishPort: rp,
        replicas: rep,
        variables: cleanVars,
        networks: { external: connectionExternal, stack: stk },
        volumes,
      });
      await invalidateServiceScopedQueries(queryClient, serviceId, authUser?.userId ?? "none");
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

  return (
    <div className="glass-panel rounded-2xl border border-violet-500/20 p-6 md:p-8">
      <h3 className="text-base font-semibold flex items-center gap-2 mb-1">
        <PackageOpen className="w-5 h-5 text-violet-700 dark:text-violet-300" />
        Application deployment
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
        {!hasDeployHost && (
          <div
            className="sm:col-span-2 rounded-lg border border-sky-400/40 bg-sky-50 dark:border-amber-500/45 dark:bg-amber-950/35 px-3 py-2.5 text-[11px] leading-snug text-sky-900 dark:text-amber-100/95"
            role="status"
          >
            <span className="font-semibold">Select a deploy host first.</span>{" "}
            Open the{" "}
            <button
              type="button"
              className="underline font-medium text-sky-900 dark:text-amber-50"
              onClick={() => onNavigateToRemoteDeployHost()}
            >
              Remote
            </button>{" "}
            tab, choose <span className="font-medium">Remote Docker host</span>, click Save, then come back here to generate the stack.
          </div>
        )}
        <div className="sm:col-span-2 space-y-2">
          <label className="text-xs font-medium text-muted-foreground block">Deploy from</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDeployTarget("source")}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                deployTarget === "source"
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-900 dark:text-violet-100"
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
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-900 dark:text-violet-100"
                  : "border-border bg-muted/55 dark:bg-black/25 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Container className="h-3.5 w-3.5 shrink-0 opacity-90" />
              Pre-built image
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/90 max-w-xl leading-relaxed">
            {deployTarget === "source"
              ? "Connect GitHub or GitLab (or paste an HTTPS URL). On deploy, the remote host clones your repo and builds from your Dockerfile or an auto-generated one."
              : "Point at an image already in a registry (or Docker Hub). Deploy pulls the image and skips building from source."}
          </p>
        </div>
        {deployTarget === "source" && (
        <div className="sm:col-span-2 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Source</label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 sm:items-stretch max-w-md">
            <button
              type="button"
              aria-expanded={showGithubPanel}
              aria-controls="github-deploy-panel"
              onClick={() =>
                setGitRepoDeployPanel((cur) => (cur === "github" ? null : "github"))
              }
              className={`flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 ${
                showGithubPanel
                  ? "border-sky-500/50 bg-sky-500/10 hover:bg-sky-500/15"
                  : "border-border bg-muted/55 dark:bg-black/25 hover:border-sky-500/35 hover:bg-accent/50"
              }`}
            >
              <Image
                src="/deployment-sources/github.svg"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 object-contain dark:invert"
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
              onClick={() =>
                setGitRepoDeployPanel((cur) => (cur === "gitlab" ? null : "gitlab"))
              }
              className={`flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
                showGitlabPanel
                  ? "border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/15"
                  : "border-border bg-muted/55 dark:bg-black/25 hover:border-orange-500/35 hover:bg-accent/50"
              }`}
            >
              <Image
                src="/deployment-sources/gitlab.svg"
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
                className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:text-sky-900 dark:text-sky-300/90 dark:hover:text-sky-200 hover:underline"
              >
                Full integration page
                <ExternalLink className="h-3 w-3 opacity-80" />
              </Link>
            </div>

            {githubAppListReady ? (
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-foreground">Repositories your GitHub App can access</p>
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
                        <Popover
                          open={githubBranchPickerKey === rk}
                          onOpenChange={(open) => {
                            setGithubBranchPickerKey((cur) => {
                              if (open) return rk;
                              return cur === rk ? null : cur;
                            });
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 shrink-0 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
                            >
                              {githubRowLabelBranch(r)}
                              <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-72 p-2"
                            align="end"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            {githubBranchPickerKey === rk ? (
                              githubBranchesQ.isLoading ? (
                                <div className="flex justify-center py-4 text-muted-foreground">
                                  <Loader2 className="h-5 w-5 animate-spin opacity-70" />
                                </div>
                              ) : githubBranchesQ.error ? (
                                <p className="text-[11px] text-destructive px-1">
                                  {githubBranchesQ.error instanceof Error
                                    ? githubBranchesQ.error.message
                                    : String(githubBranchesQ.error)}
                                </p>
                              ) : (githubBranchesQ.data?.branches ?? []).length === 0 ? (
                                <p className="text-[11px] text-muted-foreground px-1 py-2">
                                  No branches returned for this repository.
                                </p>
                              ) : (
                                <ul className="max-h-56 overflow-y-auto text-[11px]">
                                  {(githubBranchesQ.data?.branches ?? []).map((name) => (
                                    <li key={name}>
                                      <button
                                        type="button"
                                        className="w-full rounded px-2 py-1.5 text-left font-mono hover:bg-muted"
                                        onClick={() => {
                                          setGithubBranchByRepoKey((prev) => ({
                                            ...prev,
                                            [rk]: name,
                                          }));
                                          setGithubBranchPickerKey(null);
                                        }}
                                      >
                                        {name}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )
                            ) : null}
                          </PopoverContent>
                        </Popover>
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
                            onGithubQuickFetch(r);
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
                        {(() => {
                          const adRepoId = `${r.installation_id}:${r.full_name}`;
                          const isAdActive = Boolean(
                            effectiveAutoDeploy?.enabled &&
                              effectiveAutoDeploy.gitProvider === "github" &&
                              effectiveAutoDeploy.repoId === adRepoId,
                          );
                          return (
                            <button
                              type="button"
                              disabled={autoDeploySaving}
                              onClick={(e) => {
                                e.stopPropagation();
                                const branchVal =
                                  githubBranchByRepoKey[rk]?.trim() ||
                                  githubBranchOverride.trim() ||
                                  r.default_branch ||
                                  "main";
                                void queueAutoDeployToggle(!isAdActive, "github", adRepoId, branchVal);
                              }}
                              className={`inline-flex items-center justify-center gap-1 text-[10px] !py-1 !px-2.5 shrink-0 rounded-md font-medium transition-colors ${
                                isAdActive
                                  ? "border border-amber-500/45 bg-amber-500/18 text-amber-800 hover:bg-amber-500/28 dark:text-amber-200"
                                  : "btn-secondary"
                              }`}
                            >
                              {autoDeploySaving ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : isAdActive ? (
                                <>
                                  <CheckCircle className="h-3 w-3 opacity-90" aria-hidden />
                                  Auto-deploy
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-3 w-3 opacity-80" aria-hidden />
                                  Auto-deploy
                                </>
                              )}
                            </button>
                          );
                        })()}
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
                <Link href="/git/github" className="text-sky-700 hover:text-sky-900 dark:text-sky-300/90 hover:underline">
                  Git → GitHub
                </Link>{" "}
                (register the app via manifest) so the API has the App ID and private key. Until then, use a public repo HTTPS URL below (no auth).
              </p>
            )}

            <Collapsible
              open={
                githubManualSectionOpen ??
                (gitSettingsLoading || !githubAppListReady)
              }
              onOpenChange={setGithubManualSectionOpen}
              className="rounded-lg border border-border/70 bg-muted/20 dark:bg-black/10"
            >
              <CollapsibleTrigger className="flex w-full items-start gap-2 px-3 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring rounded-lg [&[data-state=open]]:rounded-b-none">
                <Image
                  src="/deployment-sources/github.svg"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 object-contain mt-0.5 dark:invert"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-medium text-foreground">Or paste GitHub HTTPS URL</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Public repositories only from here. Private repos must be fetched from the list above after the app is installed.
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    (githubManualSectionOpen ?? (gitSettingsLoading || !githubAppListReady)) &&
                      "rotate-180",
                  )}
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border/60 px-3 pb-3 pt-2 data-[state=closed]:border-t-0">
                <div className="space-y-2 max-w-xl">
                  <label className="text-[10px] font-medium text-muted-foreground block">
                    HTTPS clone URL (manual)
                  </label>
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
                    <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                      Branch (optional)
                    </label>
                    <input
                      className="input-field font-mono text-xs w-full"
                      value={githubBranchOverride}
                      onChange={(e) => setGithubBranchOverride(e.target.value)}
                      placeholder="Repository default if empty"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                        githubManualUrlStaged && !githubUrlStaging
                          ? "border border-emerald-500/45 bg-emerald-500/18 text-emerald-800 hover:bg-emerald-500/28 dark:text-emerald-200"
                          : "btn-primary !py-0"
                      }`}
                    >
                      {githubUrlStaging ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : githubManualUrlStaged ? (
                        <CheckCircle className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                      ) : null}
                      {githubManualUrlStaged && !githubUrlStaging ? "Ready" : "Fetch repo"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        autoDeploySaving ||
                        githubUrlStaging ||
                        !githubManualUrl.trim()
                      }
                      onClick={() => {
                        const url = githubManualUrl.trim();
                        if (!url) return;
                        const branchVal = githubBranchOverride.trim() || "main";
                        const isActive = Boolean(
                          effectiveAutoDeploy?.enabled &&
                            effectiveAutoDeploy.gitProvider === "github" &&
                            effectiveAutoDeploy.repoId === url,
                        );
                        void queueAutoDeployToggle(!isActive, "github", url, branchVal);
                      }}
                      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                        effectiveAutoDeploy?.enabled &&
                        effectiveAutoDeploy.gitProvider === "github" &&
                        effectiveAutoDeploy.repoId === githubManualUrl.trim()
                          ? "border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                          : "btn-secondary !py-0"
                      }`}
                    >
                      {autoDeploySaving ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : effectiveAutoDeploy?.enabled &&
                        effectiveAutoDeploy.gitProvider === "github" &&
                        effectiveAutoDeploy.repoId === githubManualUrl.trim() ? (
                        <CheckCircle className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                      )}
                      {effectiveAutoDeploy?.enabled &&
                      effectiveAutoDeploy.gitProvider === "github" &&
                      effectiveAutoDeploy.repoId === githubManualUrl.trim()
                        ? "Auto-deploy ON"
                        : "Auto-deploy"}
                    </button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
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
                      <Popover
                        open={gitlabBranchPickerProjectId === p.id}
                        onOpenChange={(open) => {
                          setGitlabBranchPickerProjectId((cur) => {
                            if (open) return p.id;
                            return cur === p.id ? null : cur;
                          });
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 shrink-0 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
                          >
                            {gitlabRowLabelBranch(p)}
                            <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-72 p-2"
                          align="end"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                        >
                          {gitlabBranchPickerProjectId === p.id ? (
                            gitlabBranchesQ.isLoading ? (
                              <div className="flex justify-center py-4 text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin opacity-70" />
                              </div>
                            ) : gitlabBranchesQ.error ? (
                              <p className="text-[11px] text-destructive px-1">
                                {gitlabBranchesQ.error instanceof Error
                                  ? gitlabBranchesQ.error.message
                                  : String(gitlabBranchesQ.error)}
                              </p>
                            ) : (gitlabBranchesQ.data?.branches ?? []).length === 0 ? (
                              <p className="text-[11px] text-muted-foreground px-1 py-2">
                                No branches returned for this project.
                              </p>
                            ) : (
                              <ul className="max-h-56 overflow-y-auto text-[11px]">
                                {(gitlabBranchesQ.data?.branches ?? []).map((name) => (
                                  <li key={name}>
                                    <button
                                      type="button"
                                      className="w-full rounded px-2 py-1.5 text-left font-mono hover:bg-muted"
                                      onClick={() => {
                                        setGitlabBranchByProjectId((prev) => ({
                                          ...prev,
                                          [p.id]: name,
                                        }));
                                        setGitlabBranchPickerProjectId(null);
                                      }}
                                    >
                                      {name}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )
                          ) : null}
                        </PopoverContent>
                      </Popover>
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
                      {(() => {
                        const adRepoId = String(p.id);
                        const isAdActive = Boolean(
                          effectiveAutoDeploy?.enabled &&
                            effectiveAutoDeploy.gitProvider === "gitlab" &&
                            effectiveAutoDeploy.repoId === adRepoId,
                        );
                        return (
                          <button
                            type="button"
                            disabled={autoDeploySaving}
                            onClick={(e) => {
                              e.stopPropagation();
                              const branchVal =
                                gitlabBranchByProjectId[p.id]?.trim() ||
                                gitlabBranchOverride.trim() ||
                                p.default_branch ||
                                "main";
                              void queueAutoDeployToggle(!isAdActive, "gitlab", adRepoId, branchVal);
                            }}
                            className={`inline-flex items-center justify-center gap-1 text-[10px] !py-1 !px-2.5 shrink-0 rounded-md font-medium transition-colors ${
                              isAdActive
                                ? "border border-amber-500/45 bg-amber-500/18 text-amber-800 hover:bg-amber-500/28 dark:text-amber-200"
                                : "btn-secondary"
                            }`}
                          >
                            {autoDeploySaving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : isAdActive ? (
                              <>
                                <CheckCircle className="h-3 w-3 opacity-90" aria-hidden />
                                Auto-deploy
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3 w-3 opacity-80" aria-hidden />
                                Auto-deploy
                              </>
                            )}
                          </button>
                        );
                      })()}
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

            <Collapsible
              open={
                gitlabManualSectionOpen ??
                (gitSettingsLoading || !gitlabAccessTokenConfigured)
              }
              onOpenChange={setGitlabManualSectionOpen}
              className="rounded-lg border border-border/70 bg-muted/20 dark:bg-black/10"
            >
              <CollapsibleTrigger className="flex w-full items-start gap-2 px-3 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring rounded-lg [&[data-state=open]]:rounded-b-none">
                <Image
                  src="/deployment-sources/gitlab.svg"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 object-contain mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-medium text-foreground">Or paste URL manually</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    If a project does not appear in the list, or your repo is public, paste its HTTPS clone URL here.
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    (gitlabManualSectionOpen ??
                      (gitSettingsLoading || !gitlabAccessTokenConfigured)) &&
                      "rotate-180",
                  )}
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border/60 px-3 pb-3 pt-2 data-[state=closed]:border-t-0">
                <div className="space-y-2 max-w-xl">
                  <label className="text-[10px] font-medium text-muted-foreground block">
                    HTTPS clone URL (manual)
                  </label>
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
                    <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                      Branch (optional)
                    </label>
                    <input
                      className="input-field font-mono text-xs w-full"
                      value={gitlabBranchOverride}
                      onChange={(e) => setGitlabBranchOverride(e.target.value)}
                      placeholder="Repository default if empty"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                        gitlabManualUrlStaged && !gitlabUrlStaging
                          ? "border border-emerald-500/45 bg-emerald-500/18 text-emerald-800 hover:bg-emerald-500/28 dark:text-emerald-200"
                          : "btn-primary !py-0"
                      }`}
                    >
                      {gitlabUrlStaging ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : gitlabManualUrlStaged ? (
                        <CheckCircle className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                      ) : null}
                      {gitlabManualUrlStaged && !gitlabUrlStaging ? "Ready" : "Fetch repo"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        autoDeploySaving ||
                        gitlabUrlStaging ||
                        !gitlabManualUrl.trim()
                      }
                      onClick={() => {
                        const url = gitlabManualUrl.trim();
                        if (!url) return;
                        const branchVal = gitlabBranchOverride.trim() || "main";
                        const isActive = Boolean(
                          effectiveAutoDeploy?.enabled &&
                            effectiveAutoDeploy.gitProvider === "gitlab" &&
                            effectiveAutoDeploy.repoId === url,
                        );
                        void queueAutoDeployToggle(!isActive, "gitlab", url, branchVal);
                      }}
                      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                        effectiveAutoDeploy?.enabled &&
                        effectiveAutoDeploy.gitProvider === "gitlab" &&
                        effectiveAutoDeploy.repoId === gitlabManualUrl.trim()
                          ? "border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                          : "btn-secondary !py-0"
                      }`}
                    >
                      {autoDeploySaving ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : effectiveAutoDeploy?.enabled &&
                        effectiveAutoDeploy.gitProvider === "gitlab" &&
                        effectiveAutoDeploy.repoId === gitlabManualUrl.trim() ? (
                        <CheckCircle className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                      )}
                      {effectiveAutoDeploy?.enabled &&
                      effectiveAutoDeploy.gitProvider === "gitlab" &&
                      effectiveAutoDeploy.repoId === gitlabManualUrl.trim()
                        ? "Auto-deploy ON"
                        : "Auto-deploy"}
                    </button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
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
        </div>
        )}
        {deployTarget === "source" && (
        <>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Build path</label>
          <input className="input-field font-mono text-sm" value={buildPath} onChange={(e) => setBuildPath(e.target.value)} placeholder="." />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground block">Build strategy</label>
          <select
            className="input-field font-mono text-sm max-w-md"
            value={appBuildStrategy}
            onChange={(e) => setAppBuildStrategy(e.target.value as "dockerfile" | "nixpacks")}
          >
            <option value="dockerfile">Dockerfile — docker build from Dockerfile in build path</option>
            <option value="nixpacks">Nixpacks — auto-detect stack, build on deploy host</option>
          </select>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Dockerfile: your repo must include a <code className="text-[10px]">Dockerfile</code> under the build path; it is used when building on the deploy host after Git clone.
            Nixpacks: runs <code className="text-[10px]">nixpacks build</code> on the remote host — install the CLI via that host&apos;s{" "}
            <Link href="/remote-server" className="font-medium text-primary underline-offset-2 hover:underline">
              Installs &amp; maintenance
            </Link>{" "}
            → Nixpacks CLI only.
          </p>
        </div>
        </>
        )}
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
            onExternalChange={setConnectionExternalAndDirty}
            onStackKeysChange={setConnectionStackKeysAndDirty}
            open={openAppSection === "connections"}
            onOpenChange={(next) => setOpenAppSection(next ? "connections" : null)}
          />
          <details className="group" open>
            <summary
              onClick={(e) => {
                e.preventDefault();
                setOpenAppSection((prev) => (prev === "volumes" ? null : "volumes"));
              }}
              className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-border bg-muted/35 px-3 py-2.5 text-left transition-colors hover:bg-muted/55 dark:bg-zinc-950/30 dark:hover:bg-accent/50 [&::-webkit-details-marker]:hidden"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-400/40 bg-violet-500/[0.12] dark:border-violet-500/30 dark:bg-violet-500/10">
                <HardDrive className="h-3.5 w-3.5 text-violet-700 dark:text-violet-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-100">Volumes</h3>
                  {filledVolumeCount > 0 && (
                    <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:text-violet-200">
                      {filledVolumeCount}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-muted-foreground mt-0.5 leading-snug">
                  Add volume mounts to persist app data. Saved into generated compose as <code>volumes:</code>.
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-zinc-500 dark:text-muted-foreground transition-transform duration-300 ${
                  openAppSection === "volumes" ? "rotate-180" : ""
                }`}
              />
            </summary>
            <div
              className={`grid min-h-0 overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
                openAppSection === "volumes" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-80"
              }`}
            >
              <div className="min-h-0 space-y-2 pt-3">
                {volumeRows.length === 0 && (
                  <p className="text-xs text-muted-foreground">No volumes yet. Add rows like <code>app-data</code> to <code>/data</code>.</p>
                )}
                {volumeRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <input
                      className="input-field font-mono text-sm col-span-4"
                      value={row.source}
                      onChange={(e) => {
                        setVolumesDirty(true);
                        setVolumeRows((prev) =>
                          prev.map((v, i) => (i === idx ? { ...v, source: e.target.value } : v)),
                        );
                      }}
                      placeholder="source (e.g. app-data)"
                    />
                    <input
                      className="input-field font-mono text-sm col-span-5"
                      value={row.target}
                      onChange={(e) => {
                        setVolumesDirty(true);
                        setVolumeRows((prev) =>
                          prev.map((v, i) => (i === idx ? { ...v, target: e.target.value } : v)),
                        );
                      }}
                      placeholder="/container/path"
                    />
                    <label className="col-span-2 flex items-center justify-center gap-1 rounded-lg border border-border text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={row.readOnly}
                        onChange={(e) => {
                          setVolumesDirty(true);
                          setVolumeRows((prev) =>
                            prev.map((v, i) => (i === idx ? { ...v, readOnly: e.target.checked } : v)),
                          );
                        }}
                      />
                      RO
                    </label>
                    <button
                      type="button"
                      className="btn-secondary text-xs col-span-1"
                      onClick={() => {
                        setVolumesDirty(true);
                        setVolumeRows((prev) => prev.filter((_, i) => i !== idx));
                      }}
                      title="Remove row"
                    >
                      <Trash2 className="w-3.5 h-3.5 mx-auto" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setVolumesDirty(true);
                    setVolumeRows((prev) => [...prev, { source: "", target: "", readOnly: false }]);
                  }}
                  className="btn-secondary text-xs inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Add volume
                </button>
              </div>
            </div>
          </details>
          <details
            className="group"
            open
          >
            <summary
              onClick={(e) => {
                e.preventDefault();
                setOpenAppSection((prev) => (prev === "env" ? null : "env"));
              }}
              className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-border bg-muted/35 px-3 py-2.5 text-left transition-colors hover:bg-muted/55 dark:bg-zinc-950/30 dark:hover:bg-accent/50 [&::-webkit-details-marker]:hidden"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-400/40 bg-violet-500/[0.12] dark:border-violet-500/30 dark:bg-violet-500/10">
                <Variable className="h-3.5 w-3.5 text-violet-700 dark:text-violet-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-100">Environment</h3>
                  {filledEnvVarCount > 0 && (
                    <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:text-violet-200">
                      {filledEnvVarCount}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-muted-foreground mt-0.5 leading-snug">
                  Keys & values — saved to the service environment and applied when you generate or save the stack.
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-zinc-500 dark:text-muted-foreground transition-transform duration-300 ${
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
                  {row.unreadableLegacySecret && !row.value.trim() ? (
                    <div className="input-field col-span-7 flex min-h-[2.5rem] items-center px-3 font-mono text-xs text-muted-foreground">
                      Not in environment (re-save after migrating from Docker Secret)
                    </div>
                  ) : (
                    <>
                      <input
                        type={valueVisibleByRow[idx] ? "text" : "password"}
                        className="input-field font-mono text-sm col-span-6"
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
                          <Plus className="w-3.5 h-3.5" /> Save .env values
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
        <div className="sm:col-span-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {deployTarget === "source" ? (
              <button
                type="button"
                onClick={() => void onGenerateStackFromSource()}
                disabled={
                  stackGenerating ||
                  gitlabUrlStaging ||
                  stagingProjectId !== null ||
                  githubUrlStaging ||
                  stagingGithubRepoKey !== null ||
                  !hasDeployHost
                }
                className="btn-primary text-sm inline-flex items-center gap-2"
                title={
                  !hasDeployHost
                    ? "Choose a remote Docker host on the Remote tab and Save first."
                    : undefined
                }
              >
                {stackGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : gitlabUrlStaging ||
                  stagingProjectId !== null ||
                  githubUrlStaging ||
                  stagingGithubRepoKey !== null ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PackageOpen className="w-4 h-4" />
                )}
                {stackGenerating
                  ? stackGenProgressPct != null && stackGenProgressPct < 100
                    ? `Generating… ${Math.round(stackGenProgressPct)}%`
                    : "Generating…"
                  : gitlabUrlStaging ||
                      stagingProjectId !== null ||
                      githubUrlStaging ||
                      stagingGithubRepoKey !== null
                    ? "Fetching…"
                    : !hasDeployHost
                      ? "Choose deploy host on Remote tab first…"
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
          {(stackGenerating || stackGenProgressPct !== null) && (
            <div className="w-full max-w-lg space-y-1.5">
              <Progress value={stackGenProgressPct != null ? stackGenProgressPct : 0} />
              <p className="text-[11px] text-muted-foreground leading-snug">
                {stackGenerating || stackGenProgressPct != null
                  ? stackGenProgressPct != null && stackGenProgressPct < 100
                    ? `Generating compose on the server… about ${Math.round(stackGenProgressPct)}% (estimate until the request completes).`
                    : "Finishing…"
                  : null}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EnvFilePanel (server.env → ExecutorService.parseEnv on deploy) ─────────

function EnvFilePanel({ service }: { service: Service }) {
  const updateService = useUpdateService();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hideSecrets, setHideSecrets] = useState(true);

  const envText = service.env ?? "";
  const entries = countEnvEntries(editing ? draft : envText);
  const displayEnvText = useMemo(() => {
    if (!hideSecrets) return envText;
    return envText
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !line.includes("=")) return line;
        const match = line.match(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.*)$/);
        if (!match) return line;
        return `${match[1]}********`;
      })
      .join("\n");
  }, [envText, hideSecrets]);

  const handleSave = () => {
    updateService.mutate(
      { id: serviceQueryKeyId(service), patch: { env: draft } },
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
          <button
            type="button"
            onClick={() => setHideSecrets((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/60 border border-border transition-colors"
            title={hideSecrets ? "Show secrets" : "Hide secrets"}
            aria-label={hideSecrets ? "Show secrets" : "Hide secrets"}
          >
            {hideSecrets ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {hideSecrets ? "Show secrets" : "Hide secrets"}
          </button>
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
            displayEnvText
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
  const { data: projectServices } = useServices(service.projectId);

  const seedKey = `${service.id}:${JSON.stringify(service.traefikRoutes)}:${JSON.stringify(service.domains)}`;
  const [routes, setRoutes] = useState<TraefikRouteRule[]>(() => buildInitialTraefikRoutes(service));

  useEffect(() => {
    setRoutes(buildInitialTraefikRoutes(service));
  }, [seedKey]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftRouter, setDraftRouter] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [draftHost, setDraftHost] = useState("");
  const [draftInternalPort, setDraftInternalPort] = useState("");

  const deployServer = service.remoteServer;
  const serverHostnames = useMemo(
    () => hostsFromRemoteServerDomainsJson(deployServer?.domainsJson ?? null),
    [deployServer?.domainsJson],
  );

  const hostnameSelectOptions = useMemo(() => {
    const list = [...serverHostnames];
    const cur = draftHost.trim();
    if (cur && !list.some((h) => h.toLowerCase() === cur.toLowerCase())) {
      list.unshift(cur);
    }
    return list;
  }, [serverHostnames, draftHost]);

  const resetDraft = () => {
    setDraftRouter("");
    setDraftPath("");
    setDraftHost("");
    setDraftInternalPort("");
    setEditingIndex(null);
  };

  const openAddDialog = () => {
    setEditingIndex(null);
    setDraftRouter("");
    setDraftPath("");
    setDraftHost("");
    setDraftInternalPort("");
    setDialogOpen(true);
  };

  const openEditDialog = (index: number) => {
    const r = routes[index];
    setEditingIndex(index);
    setDraftRouter(r.router);
    setDraftPath(r.pathPrefix ?? "");
    setDraftHost(singleHostLabel(r.hosts));
    setDraftInternalPort(
      r.port != null && Number.isFinite(r.port) ? String(Math.floor(r.port)) : "",
    );
    setDialogOpen(true);
  };

  const sanitizeAndPersist = (next: TraefikRouteRule[], onDone?: () => void) => {
    const sanitized: TraefikRouteRule[] = [];
    for (const r of next) {
      const router = r.router.trim().toLowerCase();
      const hosts = (r.hosts ?? []).map((h) => h.trim()).filter(Boolean).slice(0, 1);
      if (!router || !/^[a-z][a-z0-9_-]*$/.test(router)) continue;
      if (!hosts.length) continue;
      let pathPrefix = r.pathPrefix?.trim() ?? null;
      if (pathPrefix === "") pathPrefix = null;
      if (pathPrefix && !pathPrefix.startsWith("/")) pathPrefix = `/${pathPrefix}`;
      sanitized.push({
        router,
        hosts,
        pathPrefix,
        port: sanitizeTraefikInternalPort(r.port),
        https: r.https !== false,
      });
    }

    saveRoutesMutation.mutate(
      {
        id: serviceQueryKeyId(service),
        patch: {
          traefikRoutes: sanitized,
          domains: [],
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "Redeploy the stack to apply Traefik labels." });
          onDone?.();
        },
        onError: (e: Error) =>
          toast({ title: "Error", description: e.message, variant: "destructive" }),
      },
    );
  };

  const submitDialog = () => {
    const router = draftRouter.trim().toLowerCase();
    const hosts = parseSingleHostname(draftHost);
    if (!router || !/^[a-z][a-z0-9_-]*$/.test(router)) {
      toast({
        title: "Invalid router",
        description: "Use a lowercase name starting with a letter (a–z, 0–9, _, -).",
        variant: "destructive",
      });
      return;
    }
    if (!hosts.length) {
      toast({
        title: "Hostname required",
        description: deployServer
          ? serverHostnames.length
            ? "Choose a hostname from the list for this deploy server."
            : "Add hostnames for this server on the Domains page first."
          : "Set a deploy server on the Remote tab, then add hostnames on the Domains page.",
        variant: "destructive",
      });
      return;
    }
    const dup = routes.some((r, i) => {
      if (editingIndex !== null && i === editingIndex) return false;
      return r.router.trim().toLowerCase() === router;
    });
    if (dup) {
      toast({
        title: "Duplicate router name",
        description:
          "Each route needs a unique router name (Traefik labels share the same key per name). Change the router field.",
        variant: "destructive",
      });
      return;
    }
    const conflictingService = (projectServices ?? []).find((svc) => {
      if (String(svc.id) === String(service.id)) return false;
      return (svc.traefikRoutes ?? []).some(
        (r) => (r.router ?? "").trim().toLowerCase() === router,
      );
    });
    if (conflictingService) {
      toast({
        title: "Router name already used",
        description: `This route will not work because "${router}" is already used by service "${conflictingService.name}". Choose a unique router name.`,
        variant: "destructive",
      });
      return;
    }
    let pathPrefix = draftPath.trim() || null;
    if (pathPrefix && !pathPrefix.startsWith("/")) pathPrefix = `/${pathPrefix}`;

    const portTrim = draftInternalPort.trim();
    if (!portTrim) {
      toast({
        title: "Internal port required",
        description: "Enter the container port Traefik should forward to (1–65535).",
        variant: "destructive",
      });
      return;
    }
    const n = Number(portTrim);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      toast({
        title: "Invalid internal port",
        description: "Use an integer from 1 to 65535.",
        variant: "destructive",
      });
      return;
    }
    const port = n;

    const entry: TraefikRouteRule = {
      router,
      hosts,
      pathPrefix,
      port,
      https: true,
    };
    const next = [...routes];
    if (editingIndex === null) next.push(entry);
    else next[editingIndex] = entry;

    sanitizeAndPersist(next, () => {
      setDialogOpen(false);
      resetDraft();
    });
  };

  const deleteDomain = (index: number) => {
    const next = routes.filter((_, i) => i !== index);
    sanitizeAndPersist(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Domains</p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-2xl">
            Add a domain to your service. Register hostnames on the{" "}
            <Link href="/domains" className="text-primary hover:underline">
              Domains
            </Link>{" "}
            page.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddDialog}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 dark:border-white/20 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
        >
          <Plus className="w-4 h-4" />
          Add domain
        </button>
      </div>

      <div className="space-y-4">
        {routes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-6 py-14 text-center">
            <Globe className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">No domains yet.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Use Add domain to create a route.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {routes.map((route, index) => (
              <motion.div
                key={`${service.id}-traefik-route-${index}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="group flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-card/50 px-4 py-3.5 hover:border-border/90 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  {(() => {
                    const hostLabel = singleHostLabel(route.hosts);
                    const useHttps = route.https !== false;
                    const openUrl = publicRouteOpenUrl(hostLabel, route.pathPrefix, useHttps);
                    if (!hostLabel) {
                      return <p className="font-mono text-sm font-medium text-muted-foreground">—</p>;
                    }
                    if (!openUrl) {
                      return (
                        <p className="font-mono text-sm font-medium text-foreground truncate" title={hostLabel}>
                          {hostLabel}
                        </p>
                      );
                    }
                    return (
                      <a
                        href={openUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 min-w-0 max-w-full font-mono text-sm font-medium text-primary hover:underline"
                        title={openUrl}
                      >
                        <span className="truncate">{hostLabel}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden />
                      </a>
                    );
                  })()}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground/60">router</span> {route.router || "—"}
                    </span>
                    {route.pathPrefix ? (
                      <span>
                        <span className="font-medium text-foreground/60">path</span>{" "}
                        <span className="font-mono">{route.pathPrefix}</span>
                      </span>
                    ) : null}
                    <span>
                      <span className="font-medium text-foreground/60">TLS</span>{" "}
                      {route.https !== false ? "HTTPS" : "HTTP"}
                    </span>
                    <span>
                      <span className="font-medium text-foreground/60">internal port</span>{" "}
                      {route.port != null ? (
                        <span className="font-mono">{route.port}</span>
                      ) : (
                        <span className="text-amber-700/90 dark:text-amber-500/90">not set — edit to add</span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditDialog(index)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/70 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDomain(index)}
                    disabled={saveRoutesMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDialogOpen(false);
            resetDraft();
          } else {
            setDialogOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingIndex === null ? "Add domain" : "Edit domain"}</DialogTitle>
            <DialogDescription>Route a hostname to your service.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="block space-y-1.5">
              <span className="text-[11px] text-muted-foreground">Router name</span>
              <input
                className="input-field w-full font-mono text-sm"
                placeholder="backend"
                value={draftRouter}
                onChange={(e) => setDraftRouter(e.target.value.trim().toLowerCase())}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] text-muted-foreground">Path prefix (optional)</span>
              <input
                className="input-field w-full font-mono text-sm"
                placeholder="/api"
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
              />
            </label>
            <div className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">Hostname</span>
              <select
                className="input-field w-full min-w-0 font-mono text-sm"
                value={draftHost}
                onChange={(e) => setDraftHost(e.target.value)}
                disabled={!deployServer || hostnameSelectOptions.length === 0}
              >
                <option value="">
                  {!deployServer
                    ? "Set a deploy server on the Remote tab first"
                    : hostnameSelectOptions.length === 0
                      ? "No hostnames for this server — add on Domains"
                      : "Select hostname"}
                </option>
                {hostnameSelectOptions.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              {!deployServer ? (
                <p className="text-[11px] text-muted-foreground">
                  Set deploy server under <strong>Remote</strong>, then add hostnames on{" "}
                  <Link href="/domains" className="text-primary hover:underline">
                    Domains
                  </Link>
                  .
                </p>
              ) : serverHostnames.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Add hostnames on{" "}
                  <Link href="/domains" className="text-primary hover:underline">
                    Domains
                  </Link>{" "}
                  first.
                </p>
              ) : null}
            </div>
            <label className="block space-y-1.5">
              <span className="text-[11px] text-muted-foreground">
                Internal port <span className="text-destructive">*</span>
              </span>
              <input
                type="number"
                required
                min={1}
                max={65535}
                className="input-field w-full font-mono text-sm"
                placeholder="e.g. 3000"
                value={draftInternalPort}
                onChange={(e) => setDraftInternalPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
              />
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => {
                setDialogOpen(false);
                resetDraft();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saveRoutesMutation.isPending}
              className="btn-primary text-sm"
              onClick={submitDialog}
            >
              {saveRoutesMutation.isPending ? "Saving…" : "Save"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

