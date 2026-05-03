import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { parseConsoleServerSlug } from "@/lib/console-target";
import { fetchOrganizationSSR, fetchRemoteServersSSR } from "@/lib/server-fetch";
import { redirectOrgWorkspaceAccessDenied } from "@/lib/org-workspace-access-denied";
import {
  ORG_WORKSPACE_PERMISSIONS,
  orgMemberAllowsRemoteServerDockerManager,
} from "@/lib/org-workspace-permissions";

export default async function DockerManagerServerLayout({
  children,
  params,
  searchParams,
}: {
  children: ReactNode;
  params: Promise<{ serverId: string }>;
  searchParams?: Promise<{ organizationPublicId?: string | string[] }>;
}) {
  const { serverId } = await params;
  const sp = searchParams ? await searchParams : {};
  const orgRaw = sp.organizationPublicId;
  const organizationPublicId =
    typeof orgRaw === "string" ? orgRaw.trim() : Array.isArray(orgRaw) ? String(orgRaw[0] ?? "").trim() : "";
  const target = parseConsoleServerSlug(serverId);
  /** Block invalid / legacy numeric slugs before rendering any console page. */
  if (target == null || /^[0-9]+$/.test(target)) {
    redirect("/resource-not-found");
  }
  /** Enforce access: personal remote servers, or org servers when `organizationPublicId` matches. */
  const remoteServers = await fetchRemoteServersSSR(
    organizationPublicId !== "" ? organizationPublicId : undefined,
  );
  const canAccess = remoteServers.some(
    (row) => String(row.publicId ?? "").trim() === target,
  );
  if (!canAccess) {
    redirect("/resource-not-found");
  }

  if (organizationPublicId !== "") {
    const org = await fetchOrganizationSSR(organizationPublicId);
    if (!org) {
      redirect("/resource-not-found");
    }
    if (!orgMemberAllowsRemoteServerDockerManager(org.workspacePermissions)) {
      redirectOrgWorkspaceAccessDenied(
        organizationPublicId,
        ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER_DOCKER_MANAGER,
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
        <span className="text-muted-foreground">Weehawk · </span>
        <span className="font-medium text-foreground">Deploy server · {serverId}</span>
      </div>
      {children}
    </div>
  );
}
