"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Cpu,
  MemoryStick,
  Play,
  Wifi,
  XCircle,
  Square,
  Box,
} from "lucide-react";
import Link from "next/link";
import {
  DOCKER_API_HELP,
  dockerMonitorOverviewWsUrl,
  findStatsForContainer,
  mapDockerPsRow,
  mapDockerStatsRow,
  type DockerContainer,
  type DockerContainerStats,
  type ContainerStatus,
} from "@/lib/docker-api";

function formatUptimeLabel(createdAt: string, running: boolean): string {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) {
    return running ? `${createdAt} uptime` : `Stopped (${createdAt})`;
  }
  if (running) {
    return `${formatDistanceToNow(new Date(ms), { addSuffix: false })} uptime`;
  }
  return `Stopped ${formatDistanceToNow(new Date(ms), { addSuffix: true })}`;
}

function parseDockerDataSize(s: string): number {
  const t = s.trim().replace(/\s+/g, "");
  const m = t.match(/^([\d.,]+)\s*([a-zA-Z]+)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(",", "."));
  const u = (m[2] || "B").toLowerCase();
  if (u === "b" || u === "byte" || u === "bytes") return n;
  if (u === "kb" || u === "kib") return n * 1024;
  if (u === "mb" || u === "mib") return n * 1024 * 1024;
  if (u === "gb" || u === "gib") return n * 1024 * 1024 * 1024;
  if (u === "tb" || u === "tib") return n * 1024 * 1024 * 1024 * 1024;
  return n;
}

function formatBytesShort(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const STATUS_DOT: Record<ContainerStatus, string> = {
  running: "bg-emerald-400",
  stopped: "bg-zinc-500",
  exited: "bg-red-400",
};
const STATUS_LABEL: Record<ContainerStatus, string> = {
  running: "text-emerald-400",
  stopped: "text-zinc-400",
  exited: "text-red-400",
};
const STATUS_CARD: Record<ContainerStatus, string> = {
  running: "border-white/5",
  stopped: "border-amber-500/20 bg-amber-500/[0.02]",
  exited: "border-red-500/20 bg-red-500/[0.02]",
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ContainerCard({
  container,
  stats,
}: {
  container: DockerContainer;
  stats: DockerContainerStats | undefined;
}) {
  const isRunning = container.status === "running";
  const cpu = stats?.cpuPercent ?? 0;
  const mem = stats?.memoryUsedMiB ?? 0;
  const memLimit = Math.max(stats?.memoryLimitMiB ?? 512, 1);
  const cpuColor = cpu > 80 ? "bg-red-400" : cpu > 50 ? "bg-amber-400" : "bg-emerald-400";
  const memPct = (mem / memLimit) * 100;
  const memColor = memPct > 80 ? "bg-red-400" : memPct > 60 ? "bg-amber-400" : "bg-primary";

  return (
    <div className={`glass-panel rounded-2xl p-5 border ${STATUS_CARD[container.status]}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
              isRunning
                ? "bg-emerald-500/10 border-emerald-500/20"
                : container.status === "exited"
                  ? "bg-red-500/10 border-red-500/20"
                  : "bg-zinc-500/10 border-zinc-500/20"
            }`}
          >
            {isRunning ? (
              <Play className="w-4 h-4 text-emerald-400" />
            ) : container.status === "exited" ? (
              <XCircle className="w-4 h-4 text-red-400" />
            ) : (
              <Square className="w-4 h-4 text-zinc-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-mono font-semibold text-sm truncate">{container.name}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{container.image}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[container.status]} ${
              isRunning ? "animate-pulse" : ""
            }`}
          />
          <span className={`text-xs font-semibold capitalize ${STATUS_LABEL[container.status]}`}>
            {container.status}
          </span>
        </div>
      </div>

      {!isRunning && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-4 text-xs font-medium ${
            container.status === "exited"
              ? "bg-red-500/10 text-red-400 border border-red-500/20"
              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {container.status === "exited"
            ? "Container exited — check logs on the host"
            : "Container is stopped — not serving traffic"}
        </div>
      )}

      {isRunning ? (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Cpu className="w-3 h-3" />
                CPU
              </span>
              <span
                className={`text-xs font-bold ${
                  cpu > 80 ? "text-red-400" : cpu > 50 ? "text-amber-400" : "text-foreground"
                }`}
              >
                {stats ? `${cpu.toFixed(2)}%` : "—"}
              </span>
            </div>
            <Bar value={cpu} max={100} color={cpuColor} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MemoryStick className="w-3 h-3" />
                Memory
              </span>
              <span className={`text-xs font-bold ${memPct > 80 ? "text-red-400" : "text-foreground"}`}>
                {stats ? (
                  <>
                    {mem.toFixed(0)} MiB{" "}
                    <span className="text-muted-foreground font-normal">/ {memLimit.toFixed(0)} MiB</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <Bar value={mem} max={memLimit} color={memColor} />
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-white/5">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wifi className="w-3 h-3" />
              Network (cumulative)
            </span>
            <div className="flex items-center gap-3 text-xs text-right">
              <span className="flex items-center gap-1 text-emerald-400">
                <ArrowDown className="w-3 h-3 flex-shrink-0" />
                <span className="font-mono">{stats?.netIoIn ?? "—"}</span>
              </span>
              <span className="flex items-center gap-1 text-zinc-300">
                <ArrowUp className="w-3 h-3 flex-shrink-0" />
                <span className="font-mono">{stats?.netIoOut ?? "—"}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-white/5">
            <span>{container.ports && container.ports !== "—" ? container.ports : "No ports exposed"}</span>
            <span>{formatUptimeLabel(container.createdAt, true)}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-white/5 pt-3">
          <span>{container.ports && container.ports !== "—" ? container.ports : "No ports"}</span>
          <span>{formatUptimeLabel(container.createdAt, false)}</span>
        </div>
      )}
    </div>
  );
}

type OverviewMessage =
  | { type: "overview"; at?: number; data?: { containers?: unknown; stats?: unknown } }
  | { type: "stats"; at?: number; data?: unknown }
  | { type: "error"; message?: string };

export function HomePageClient() {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [statsRows, setStatsRows] = useState<DockerContainerStats[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;

    const connect = () => {
      ws = new WebSocket(dockerMonitorOverviewWsUrl({ intervalMs: 2000 }));

      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
      };

      ws.onmessage = (ev) => {
        if (disposed) return;
        if (typeof ev.data !== "string") return;
        let msg: OverviewMessage;
        try {
          msg = JSON.parse(ev.data) as OverviewMessage;
        } catch {
          return;
        }

        if (msg.type === "error") {
          setLoadError(msg.message ?? "WebSocket error");
          return;
        }

        if (msg.type === "overview") {
          const rawContainers = Array.isArray(msg.data?.containers) ? msg.data?.containers : [];
          const rawStats = Array.isArray(msg.data?.stats) ? msg.data?.stats : [];
          setContainers(rawContainers.map((row, i) => mapDockerPsRow(row as Record<string, unknown>, i)));
          setStatsRows(rawStats.map((row) => mapDockerStatsRow(row as Record<string, unknown>)));
          setLoadError(null);
          setUpdatedAt(msg.at ?? Date.now());
          return;
        }

        if (msg.type === "stats") {
          const rawStats = Array.isArray(msg.data) ? msg.data : [];
          setStatsRows(rawStats.map((row) => mapDockerStatsRow(row as Record<string, unknown>)));
          setUpdatedAt(msg.at ?? Date.now());
        }
      };

      ws.onerror = () => {
        if (disposed) return;
        setConnected(false);
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        setTimeout(() => {
          if (!disposed) connect();
        }, 1500);
      };
    };

    connect();

    return () => {
      disposed = true;
      setConnected(false);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const running = containers.filter((c) => c.status === "running");
  const issues = containers.filter((c) => c.status !== "running");

  const runningStats = running
    .map((c) => findStatsForContainer(c, statsRows))
    .filter((s): s is DockerContainerStats => s !== undefined);

  const totalCpu =
    runningStats.length > 0 ? runningStats.reduce((s, x) => s + x.cpuPercent, 0) / runningStats.length : 0;
  const totalMemIn = runningStats.reduce((s, x) => s + x.memoryUsedMiB, 0);
  const totalNetInBytes = runningStats.reduce((s, x) => s + parseDockerDataSize(x.netIoIn), 0);
  const totalNetOutBytes = runningStats.reduce((s, x) => s + parseDockerDataSize(x.netIoOut), 0);

  const healthy = issues.length === 0 && loadError == null;
  const lastUpdatedLabel = useMemo(() => {
    if (!updatedAt) return "Waiting for live data...";
    return `Last updated ${formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}`;
  }, [updatedAt]);

  return (
    <>
      {loadError && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <p className="font-medium">Could not load containers</p>
          <p className="text-red-300/80 mt-1">{loadError}</p>
          <p className="text-xs text-muted-foreground mt-2">{DOCKER_API_HELP}</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="w-7 h-7 text-primary" />
            Overview
          </h1>
          <p className="text-xs text-muted-foreground mt-1">{lastUpdatedLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`glass-panel rounded-xl px-4 py-2.5 flex items-center gap-2.5 border ${
              healthy ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
            }`}
          >
            {healthy ? (
              <>
                <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"}`} />
                <span className="text-sm font-medium text-emerald-400">
                  {connected ? "Live updates connected" : "Reconnecting..."}
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-400">
                  {loadError
                    ? "Live feed error"
                    : `${issues.length} Container${issues.length > 1 ? "s" : ""} With Issues`}
                </span>
              </>
            )}
          </div>

        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Running",
            value: running.length,
            sub: `of ${containers.length} total`,
            color: "text-emerald-400",
            icon: <Play className="w-4 h-4" />,
            bg: "bg-emerald-500/10 border-emerald-500/20",
          },
          {
            label: "Issues",
            value: issues.length,
            sub: issues.length > 0 ? "needs attention" : "all clear",
            color: issues.length > 0 ? "text-red-400" : "text-zinc-400",
            icon: <AlertTriangle className="w-4 h-4" />,
            bg: issues.length > 0 ? "bg-red-500/10 border-red-500/20" : "bg-zinc-500/10 border-zinc-500/20",
          },
          {
            label: "Avg CPU",
            value: runningStats.length ? `${totalCpu.toFixed(2)}%` : "—",
            sub: "matched running + stats",
            color: totalCpu > 80 ? "text-red-400" : "text-foreground",
            icon: <Cpu className="w-4 h-4" />,
            bg: "bg-primary/10 border-primary/20 text-primary",
          },
          {
            label: "Memory Used",
            value: runningStats.length ? `${totalMemIn.toFixed(0)} MiB` : "—",
            sub: "total in use (matched)",
            color: "text-foreground",
            icon: <MemoryStick className="w-4 h-4" />,
            bg: "bg-zinc-500/10 border-zinc-500/20 text-zinc-300",
          },
        ].map((s) => (
          <div key={s.label} className="glass-panel rounded-xl p-5">
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-3 ${s.bg}`}>{s.icon}</div>
            <p className={`text-2xl font-bold mb-0.5 ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="glass-panel rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8 border border-white/5">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wifi className="w-4 h-4 text-primary" />
          Network I/O (cumulative, running containers with stats)
        </span>
        <div className="flex items-center gap-6 text-sm">
          <span className="flex items-center gap-2 text-emerald-400 font-semibold">
            <ArrowDown className="w-4 h-4" /> {formatBytesShort(totalNetInBytes)}{" "}
            <span className="text-muted-foreground font-normal text-xs">in</span>
          </span>
          <span className="flex items-center gap-2 text-zinc-300 font-semibold">
            <ArrowUp className="w-4 h-4" /> {formatBytesShort(totalNetOutBytes)}{" "}
            <span className="text-muted-foreground font-normal text-xs">out</span>
          </span>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" />
              Containers With Issues
            </h2>
            <Link href="/console/local/containers">
              <span className="text-xs text-primary hover:underline cursor-pointer">Manage →</span>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {issues.map((c) => (
              <ContainerCard key={c.id} container={c} stats={findStatsForContainer(c, statsRows)} />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-emerald-400">
            <CheckCircle className="w-4 h-4" />
            Running Containers
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Live (WebSocket)
          </div>
        </div>

        {running.length === 0 ? (
          <div className="glass-panel rounded-2xl py-16 text-center">
            <Box className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-muted-foreground mb-1">No running containers</p>
            <Link href="/console/local/containers">
              <span className="text-xs text-primary hover:underline cursor-pointer">Open containers →</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {running.map((c) => (
              <ContainerCard key={c.id} container={c} stats={findStatsForContainer(c, statsRows)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
