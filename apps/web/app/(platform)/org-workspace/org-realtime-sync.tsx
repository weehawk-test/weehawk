"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/contexts/auth-context";
import { socketIoHttpBase } from "@/lib/api";
import { ORG_DATA_CHANGED_EVENT, type OrgDataChangedDetail } from "@/lib/org-realtime-events";
import { useOrgWorkspace } from "./org-workspace-context";

/**
 * Subscribes to org-scoped `data_changed` events and refreshes TanStack Query caches.
 * Server membership and room assignment are enforced via JWT + org public id (see API gateway).
 */
export function OrgRealtimeSync() {
  const { user } = useAuth();
  const org = useOrgWorkspace();
  const queryClient = useQueryClient();

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
      void queryClient.invalidateQueries({ queryKey: ["projects"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["services"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["service"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["webhooks"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["cron-jobs"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["deploy-logs"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["remote-servers"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["traefik"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["notifications"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["registry-accounts"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["git-settings"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["s3-profiles"], exact: false });
    };

    socket.on("data_changed", onDataChanged);

    return () => {
      socket.off("data_changed", onDataChanged);
      socket.disconnect();
    };
  }, [user?.userId, org.publicId, queryClient]);

  return null;
}
