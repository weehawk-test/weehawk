"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchRemoteServers,
  type RemoteServerRow,
} from "@/lib/remote-servers-api";
import { ServerDomainsCard } from "@/components/domains/server-domains-card";
import { isLetsEncryptEmailConfigured } from "@/lib/traefik-acme-email";
import { useOptionalOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { orgScopedQuerySegment } from "@/lib/react-query-scope";
import { orgMemberAllowsDomainsAddSites } from "@/lib/org-workspace-permissions";

export function ServerDomainsPageClient({
  serverId,
  initialRemoteServers,
  activeOrgPublicId = null,
  initialRemoteServersOrganizationId = null,
}: {
  serverId: string;
  initialRemoteServers?: RemoteServerRow[];
  activeOrgPublicId?: string | null;
  initialRemoteServersOrganizationId?: string | null;
}) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const orgWorkspace = useOptionalOrgWorkspace();
  const trimmedOrg = activeOrgPublicId?.trim() ?? "";
  const trimmedSsrOrg = initialRemoteServersOrganizationId?.trim() ?? "";
  const useSsrRemoteInitial =
    initialRemoteServers !== undefined && trimmedOrg === trimmedSsrOrg;
  const inOrgDomains = trimmedOrg !== "";
  const allowOrgAddSites =
    !inOrgDomains ||
    (orgWorkspace != null && orgMemberAllowsDomainsAddSites(orgWorkspace.workspacePermissions));
  const orgScopeSegment = orgScopedQuerySegment(trimmedOrg);
  const remoteServersQueryKey = ["remote-servers", orgScopeSegment] as const;

  const q = useQuery({
    queryKey: remoteServersQueryKey,
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
    initialData: useSsrRemoteInitial ? initialRemoteServers : undefined,
    initialDataUpdatedAt: useSsrRemoteInitial ? Date.now() : undefined,
    staleTime: 10_000,
    refetchOnMount: true,
  });

  const server = useMemo(() => {
    if (!q.data) return null;
    return (
      q.data.find(
        (s) => s.publicId === serverId || String(s.id) === serverId,
      ) ?? null
    );
  }, [q.data, serverId]);

  const dismiss = () => router.push("/remote-server");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domainsEnabled =
    server != null && isLetsEncryptEmailConfigured(server.acmeEmail) && allowOrgAddSites;

  const content = (
    <div
      className="fixed inset-0 z-[120] flex min-h-[100dvh] items-end justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-xl dark:bg-black/55 sm:items-center sm:p-4"
      onClick={dismiss}
    >
      <div
        className="glass-panel max-h-[calc(100dvh-env(safe-area-inset-bottom))] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl sm:p-5 sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 pr-2">
            <h3 className="text-base font-semibold">
              Domains{server ? ` — ${server.name}` : ""}
            </h3>
            {server ? (
              <p className="mt-1 text-xs text-muted-foreground font-mono">
                {server.sshUser}@{server.host}:{server.port}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground sm:h-8 sm:w-8"
            aria-label="Close domains dialog"
          >
            <X className="size-4" />
          </button>
        </div>

        {!accessToken || q.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="size-5 animate-spin" />
            Loading…
          </div>
        ) : server ? (
          <ServerDomainsCard
            server={server}
            accessToken={accessToken}
            domainsEnabled={domainsEnabled}
            remoteServersQueryKey={remoteServersQueryKey}
            orgName={orgWorkspace?.name}
          />
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-3 py-4 text-center">
            Server not found.
          </p>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
