import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { parseConsoleServerSlug } from "@/lib/console-target";
import { fetchOrganizationSSR, fetchRemoteServersSSR } from "@/lib/server-fetch";
import { redirectOrgWorkspaceAccessDenied } from "@/lib/org-workspace-access-denied";
import {
  ORG_WORKSPACE_PERMISSIONS,
  orgMemberAllowsRemoteServerDockerManager,
} from "@/lib/org-workspace-permissions";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

export default async function DockerManagerServerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const organizationPublicId = (await getServerActiveOrganizationPublicId()) ?? "";
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
      <div className="hidden rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm md:block">
        <span className="text-muted-foreground">Weehawk · </span>
        <span className="font-medium text-foreground">Deploy server · {serverId}</span>
      </div>
      {children}
    </div>
  );
}
