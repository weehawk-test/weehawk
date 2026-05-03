import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DockerSecretsClient } from "@/(platform)/secrets/secrets-client";

export const dynamic = "force-dynamic";
import { parseConsoleServerSlug } from "@/lib/console-target";
import {
  DOCKER_LIST_PAGE_SIZE,
  type PaginatedSecretsResponse,
} from "@/lib/docker-paged-fetch";
import { filterSecretsPageWithPendingSet } from "@/lib/docker-secrets-pending";
import {
  pendingDeletionCookieKey,
  readPendingDeletionsFromCookie,
} from "@/lib/pending-deletions";
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
    const cookieStore = await cookies();
    const pending = readPendingDeletionsFromCookie(
      "docker-secrets",
      cookieStore.get(pendingDeletionCookieKey("docker-secrets"))?.value,
    );
    if (data) {
      data = filterSecretsPageWithPendingSet(data, pending, remoteServerId);
    }
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
