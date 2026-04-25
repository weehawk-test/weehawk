import { redirect } from "next/navigation";
import { DockerVolumesClient } from "@/(platform)/docker/volumes/volumes-client";
import { parseConsoleServerSlug } from "@/lib/console-target";

export default async function DockerManagerVolumesPage({
  params,
  searchParams,
}: {
  params: Promise<{ serverId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { serverId } = await params;
  const consoleTarget = parseConsoleServerSlug(serverId);
  if (consoleTarget == null) redirect("/resource-not-found");
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";
  return <DockerVolumesClient consoleTarget={consoleTarget} urlPage={page} urlQ={q} />;
}
