import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { parseConsoleServerSlug } from "@/lib/console-target";
import { fetchRemoteServersSSR } from "@/lib/server-fetch";

export default async function DockerManagerServerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const target = parseConsoleServerSlug(serverId);
  /** Block invalid / legacy numeric slugs before rendering any console page. */
  if (target == null || /^[0-9]+$/.test(target)) {
    redirect("/resource-not-found");
  }
  /** Enforce ownership here: only allow console URLs for the user's own remote server publicId. */
  const remoteServers = await fetchRemoteServersSSR();
  const canAccess = remoteServers.some(
    (row) => String(row.publicId ?? "").trim() === target,
  );
  if (!canAccess) {
    redirect("/resource-not-found");
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
