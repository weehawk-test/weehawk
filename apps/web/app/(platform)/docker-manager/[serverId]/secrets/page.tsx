import { redirect } from "next/navigation";
import { DockerSecretsClient } from "@/(platform)/secrets/secrets-client";
import { parseConsoleServerSlug } from "@/lib/console-target";

export const dynamic = "force-dynamic";

export default async function DockerManagerSecretsPage({
  params,
  searchParams,
}: {
  params: Promise<{ serverId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { serverId } = await params;
  const consoleTarget = parseConsoleServerSlug(serverId);
  if (consoleTarget == null) redirect("/resource-not-found");

  const remoteServerId = consoleTarget;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  return (
    <DockerSecretsClient
      remoteServerId={remoteServerId}
      data={null}
      error={null}
      urlPage={page}
      urlQ={q}
      loadSecretsOnClient
    />
  );
}
