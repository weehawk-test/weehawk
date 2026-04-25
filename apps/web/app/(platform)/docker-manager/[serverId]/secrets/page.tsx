import { redirect } from "next/navigation";
import { DockerSecretsClient } from "@/(platform)/secrets/secrets-client";
import { parseConsoleServerSlug } from "@/lib/console-target";
import {
  DOCKER_LIST_PAGE_SIZE,
  type PaginatedSecretsResponse,
} from "@/lib/docker-paged-fetch";
import { fetchDockerSecretsPagedSSR } from "@/lib/server-fetch";

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

  let data: PaginatedSecretsResponse | null = null;
  let error: string | null = null;
  try {
    data = await fetchDockerSecretsPagedSSR(remoteServerId, page, DOCKER_LIST_PAGE_SIZE, q);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <DockerSecretsClient
      remoteServerId={remoteServerId}
      data={data}
      error={error}
      urlPage={page}
      urlQ={q}
    />
  );
}
