"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Cpu, MemoryStick, Wifi, Play, Square, XCircle,
  AlertTriangle, CheckCircle, RefreshCw, Box, Activity,
  ArrowUp, ArrowDown,
} from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  type DockerContainer,
  type DockerContainerStats,
  type ContainerStatus,
  findStatsForContainer,
  DOCKER_API_HELP,
} from "@/lib/docker-api";
import { useDockerContainers, useDockerStats } from "@/hooks/use-docker";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Parse cumulative Docker I/O strings (e.g. "1.2kB", "10MB") to bytes for totals. */
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

// ─── Progress bar ─────────────────────────────────────────────────────────────

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}

const STATUS_DOT: Record<ContainerStatus, string> = {
  running: "bg-emerald-400",
  stopped: "bg-zinc-500",
  exited:  "bg-red-400",
};
const STATUS_LABEL: Record<ContainerStatus, string> = {
  running: "text-emerald-400",
  stopped: "text-zinc-400",
  exited:  "text-red-400",
};
const STATUS_CARD: Record<ContainerStatus, string> = {
  running: "border-white/5",
  stopped: "border-amber-500/20 bg-amber-500/[0.02]",
  exited:  "border-red-500/20 bg-red-500/[0.02]",
};

// ─── Container Card ───────────────────────────────────────────────────────────

function ContainerCard({
  container,
  stats,
  index,
}: {
  container: DockerContainer;
  stats: DockerContainerStats | undefined;
  index: number;
}) {
  const isRunning = container.status === "running";
  const cpu = stats?.cpuPercent ?? 0;
  const mem = stats?.memoryUsedMiB ?? 0;
  const memLimit = Math.max(stats?.memoryLimitMiB ?? 512, 1);
  const cpuColor = cpu > 80 ? "bg-red-400" : cpu > 50 ? "bg-amber-400" : "bg-emerald-400";
  const memPct = (mem / memLimit) * 100;
  const memColor = memPct > 80 ? "bg-red-400" : memPct > 60 ? "bg-amber-400" : "bg-primary";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className={`glass-panel rounded-2xl p-5 border ${STATUS_CARD[container.status]}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
            isRunning ? "bg-emerald-500/10 border-emerald-500/20" : container.status === "exited" ? "bg-red-500/10 border-red-500/20" : "bg-zinc-500/10 border-zinc-500/20"
          }`}>
            {isRunning
              ? <Play className="w-4 h-4 text-emerald-400" />
              : container.status === "exited"
                ? <XCircle className="w-4 h-4 text-red-400" />
                : <Square className="w-4 h-4 text-zinc-400" />
            }
          </div>
          <div className="min-w-0">
            <p className="font-mono font-semibold text-sm truncate">{container.name}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{container.image}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[container.status]} ${isRunning ? "animate-pulse" : ""}`} />
          <span className={`text-xs font-semibold capitalize ${STATUS_LABEL[container.status]}`}>{container.status}</span>
        </div>
      </div>

      {!isRunning && (
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-4 text-xs font-medium ${
          container.status === "exited"
            ? "bg-red-500/10 text-red-400 border border-red-500/20"
            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
        }`}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {container.status === "exited"
            ? "Container exited — check logs on the host"
            : "Container is stopped — not serving traffic"
          }
        </div>
      )}

      {isRunning ? (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Cpu className="w-3 h-3" />CPU
              </span>
              <span className={`text-xs font-bold ${cpu > 80 ? "text-red-400" : cpu > 50 ? "text-amber-400" : "text-foreground"}`}>
                {stats ? `${cpu.toFixed(1)}%` : "—"}
              </span>
            </div>
            <Bar value={cpu} max={100} color={cpuColor} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MemoryStick className="w-3 h-3" />Memory
              </span>
              <span className={`text-xs font-bold ${memPct > 80 ? "text-red-400" : "text-foreground"}`}>
                {stats ? (
                  <>{mem.toFixed(0)} MiB <span className="text-muted-foreground font-normal">/ {memLimit.toFixed(0)} MiB</span></>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <Bar value={mem} max={memLimit} color={memColor} />
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-white/5">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wifi className="w-3 h-3" />Network (cumulative)
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
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Overview() {
  const qc = useQueryClient();
  const containersQuery = useDockerContainers();
  const statsQuery = useDockerStats({ refetchInterval: 3000 });
  const [refreshing, setRefreshing] = useState(false);

  const containers = containersQuery.data ?? [];
  const statsRows = statsQuery.data ?? [];

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.refetchQueries({ queryKey: ["docker", "containers"] }),
      qc.refetchQueries({ queryKey: ["docker", "stats"] }),
    ]);
    setRefreshing(false);
  };

  const running = containers.filter((c) => c.status === "running");
  const issues = containers.filter((c) => c.status !== "running");

  const runningStats = running
    .map((c) => findStatsForContainer(c, statsRows))
    .filter((s): s is DockerContainerStats => s !== undefined);

  const totalCpu =
    runningStats.length > 0
      ? runningStats.reduce((s, x) => s + x.cpuPercent, 0) / runningStats.length
      : 0;
  const totalMemIn = runningStats.reduce((s, x) => s + x.memoryUsedMiB, 0);
  const totalNetInBytes = runningStats.reduce((s, x) => s + parseDockerDataSize(x.netIoIn), 0);
  const totalNetOutBytes = runningStats.reduce((s, x) => s + parseDockerDataSize(x.netIoOut), 0);

  const healthy = issues.length === 0;

  const lastUpdated = Math.max(
    containersQuery.dataUpdatedAt || 0,
    statsQuery.dataUpdatedAt || 0,
  );

  const loadError = containersQuery.error instanceof Error
    ? containersQuery.error.message
    : containersQuery.error
      ? String(containersQuery.error)
      : null;

  if (containersQuery.isPending && !containersQuery.data) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-muted-foreground">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm">Loading Docker overview…</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
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
            <Activity className="w-7 h-7 text-primary" />Overview
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {lastUpdated
              ? <>Last updated {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}</>
              : "—"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`glass-panel rounded-xl px-4 py-2.5 flex items-center gap-2.5 border ${
            healthy ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
          }`}>
            {healthy
              ? <><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-sm font-medium text-emerald-400">All Systems Healthy</span></>
              : <><AlertTriangle className="w-4 h-4 text-red-400" /><span className="text-sm font-medium text-red-400">{issues.length} Container{issues.length > 1 ? "s" : ""} With Issues</span></>
            }
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || containersQuery.isFetching}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing || containersQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Running",     value: running.length,          sub: `of ${containers.length} total`, color: "text-emerald-400", icon: <Play className="w-4 h-4" />,     bg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: "Issues",      value: issues.length,           sub: issues.length > 0 ? "needs attention" : "all clear",   color: issues.length > 0 ? "text-red-400" : "text-zinc-400", icon: <AlertTriangle className="w-4 h-4" />, bg: issues.length > 0 ? "bg-red-500/10 border-red-500/20" : "bg-zinc-500/10 border-zinc-500/20" },
          { label: "Avg CPU",     value: runningStats.length ? `${totalCpu.toFixed(1)}%` : "—", sub: "matched running + stats", color: totalCpu > 80 ? "text-red-400" : "text-foreground", icon: <Cpu className="w-4 h-4" />,            bg: "bg-primary/10 border-primary/20 text-primary" },
          { label: "Memory Used", value: runningStats.length ? `${totalMemIn.toFixed(0)} MiB` : "—", sub: "total in use (matched)",         color: "text-foreground", icon: <MemoryStick className="w-4 h-4" />, bg: "bg-zinc-500/10 border-zinc-500/20 text-zinc-300" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="glass-panel rounded-xl p-5">
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-3 ${s.bg}`}>{s.icon}</div>
            <p className={`text-2xl font-bold mb-0.5 ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{s.sub}</p>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="glass-panel rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8 border border-white/5">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wifi className="w-4 h-4 text-primary" />Network I/O (cumulative, running containers with stats)
        </span>
        <div className="flex items-center gap-6 text-sm">
          <span className="flex items-center gap-2 text-emerald-400 font-semibold">
            <ArrowDown className="w-4 h-4" /> {formatBytesShort(totalNetInBytes)} <span className="text-muted-foreground font-normal text-xs">in</span>
          </span>
          <span className="flex items-center gap-2 text-zinc-300 font-semibold">
            <ArrowUp className="w-4 h-4" /> {formatBytesShort(totalNetOutBytes)} <span className="text-muted-foreground font-normal text-xs">out</span>
          </span>
        </div>
      </motion.div>

      {issues.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" />Containers With Issues
            </h2>
            <Link href="/docker/containers">
              <span className="text-xs text-primary hover:underline cursor-pointer">Manage →</span>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {issues.map((c, i) => (
              <ContainerCard
                key={c.id}
                container={c}
                stats={findStatsForContainer(c, statsRows)}
                index={i}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-emerald-400">
            <CheckCircle className="w-4 h-4" />Running Containers
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Live stats (docker stats)
          </div>
        </div>

        {running.length === 0 ? (
          <div className="glass-panel rounded-2xl py-16 text-center">
            <Box className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-muted-foreground mb-1">No running containers</p>
            <Link href="/docker/containers">
              <span className="text-xs text-primary hover:underline cursor-pointer">Open containers →</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {running.map((c, i) => (
              <ContainerCard
                key={c.id}
                container={c}
                stats={findStatsForContainer(c, statsRows)}
                index={i}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
