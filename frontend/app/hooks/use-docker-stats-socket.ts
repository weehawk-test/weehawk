"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dockerMonitorStatsWsUrl, mapDockerStatsRow, type DockerContainerStats } from "@/lib/docker-api";

type StatsMessage =
  | { type: "stats"; at?: number; data?: unknown }
  | { type: "error"; message?: string }
  | { type?: string; [k: string]: unknown };

export function useDockerStatsSocket(options?: { enabled?: boolean; intervalMs?: number }) {
  const qc = useQueryClient();
  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let ws: WebSocket | null = null;

    const connect = () => {
      ws = new WebSocket(dockerMonitorStatsWsUrl({ intervalMs: options?.intervalMs ?? 2000 }));

      ws.onmessage = (ev) => {
        if (disposed) return;
        if (typeof ev.data !== "string") return;
        let msg: StatsMessage;
        try {
          msg = JSON.parse(ev.data) as StatsMessage;
        } catch {
          return;
        }
        if (msg.type === "stats") {
          const raw = Array.isArray(msg.data) ? msg.data : [];
          const mapped: DockerContainerStats[] = raw.map((r) => mapDockerStatsRow(r as Record<string, unknown>));
          qc.setQueryData(["docker", "stats"], mapped);
          return;
        }
      };

      ws.onerror = () => {
        // ignore: we'll reconnect on close
      };

      ws.onclose = () => {
        if (disposed) return;
        // simple reconnect with small backoff
        setTimeout(() => {
          if (!disposed) connect();
        }, 1500);
      };
    };

    connect();

    return () => {
      disposed = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, options?.intervalMs, qc]);
}

