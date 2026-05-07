"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/contexts/auth-context";
import { socketIoHttpBase } from "@/lib/api";
import {
  ORG_DATA_CHANGED_EVENT,
  type OrgDataChangedDetail,
  type OrgServiceRuntimeChangedDetail,
} from "@/lib/org-realtime-events";
import { useOrgWorkspace } from "./org-workspace-context";

/**
 * Subscribes to org-scoped `data_changed` events and refreshes TanStack Query caches.
 * Server membership and room assignment are enforced via JWT + org public id (see API gateway).
 */
export function OrgRealtimeSync() {
  const { user } = useAuth();
  const org = useOrgWorkspace();
  const queryClient = useQueryClient();
  const runtimeSeqByServiceRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (user?.userId == null || !org.publicId) return;

    const base = socketIoHttpBase();
    const socket: Socket = io(`${base}/org-realtime`, {
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true,
      auth: { organizationPublicId: org.publicId },
    });

    const onDataChanged = (payload?: OrgDataChangedDetail) => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<OrgDataChangedDetail>(ORG_DATA_CHANGED_EVENT, {
            detail: payload ?? {},
          }),
        );
      }
      // SSR seeds `useProjectsPage` / `useServicesPage` with `staleTime: Infinity` and `enabled: false`;
      // default invalidation only refetches *active* queries, so new services never appear until navigation.
      void queryClient.invalidateQueries({
        queryKey: ["projects"],
        exact: false,
        refetchType: "all",
      });
      void queryClient.invalidateQueries({
        queryKey: ["services"],
        exact: false,
        refetchType: "all",
      });
      void queryClient.invalidateQueries({
        queryKey: ["service"],
        exact: false,
        refetchType: "all",
      });
      void queryClient.invalidateQueries({
        queryKey: ["service-runtime"],
        exact: false,
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["project-runtime"],
        exact: false,
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["service-volumes"],
        exact: false,
        refetchType: "all",
      });
      void queryClient.invalidateQueries({ queryKey: ["webhooks"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["cron-jobs"], exact: false });
      void queryClient.invalidateQueries({
        queryKey: ["deploy-logs"],
        exact: false,
        refetchType: "all",
      });
      void queryClient.invalidateQueries({ queryKey: ["remote-servers"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["traefik"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["notifications"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["registry-accounts"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["git-settings"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["s3-profiles"], exact: false });
    };

    const onServiceRuntimeChanged = (payload?: OrgServiceRuntimeChangedDetail) => {
      const servicePublicId = payload?.servicePublicId?.trim();
      if (!servicePublicId) return;
      const incomingSeq = Number(payload?.seq ?? 0);
      const prevSeq = runtimeSeqByServiceRef.current.get(servicePublicId) ?? 0;
      if (incomingSeq > 0 && incomingSeq < prevSeq) return;
      if (incomingSeq > 0) runtimeSeqByServiceRef.current.set(servicePublicId, incomingSeq);
      const running = payload?.running === true;
      const owner = user?.userId ?? "none";
      queryClient.setQueryData(["service-runtime", owner, servicePublicId], { running });
      if (owner !== "none") {
        queryClient.setQueryData(["service-runtime", "none", servicePublicId], { running });
      }
      queryClient.setQueriesData(
        { queryKey: ["project-runtime"] },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const current = old as {
            data?: Array<{ servicePublicId: string; running: boolean }>;
          };
          if (!Array.isArray(current.data)) return old;
          let touched = false;
          const next = current.data.map((row) => {
            if (String(row.servicePublicId) !== servicePublicId) return row;
            touched = true;
            return { ...row, running };
          });
          return touched ? { ...current, data: next } : old;
        },
      );
    };

    const syncRuntimeAfterReconnect = () => {
      void queryClient.invalidateQueries({
        queryKey: ["project-runtime"],
        exact: false,
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["service-runtime"],
        exact: false,
        refetchType: "active",
      });
    };

    socket.on("data_changed", onDataChanged);
    socket.on("service_runtime_changed", onServiceRuntimeChanged);
    socket.on("connect", syncRuntimeAfterReconnect);
    socket.on("reconnect", syncRuntimeAfterReconnect);

    return () => {
      socket.off("data_changed", onDataChanged);
      socket.off("service_runtime_changed", onServiceRuntimeChanged);
      socket.off("connect", syncRuntimeAfterReconnect);
      socket.off("reconnect", syncRuntimeAfterReconnect);
      socket.disconnect();
    };
  }, [user?.userId, org.publicId, queryClient]);

  return null;
}
