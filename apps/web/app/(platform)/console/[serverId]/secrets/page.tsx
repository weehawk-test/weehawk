import Link from "next/link";
import { notFound } from "next/navigation";
import { DockerSecretsClient } from "@/(platform)/secrets/secrets-client";
import { parseConsoleServerSlug } from "@/lib/console-target";
import {
  DOCKER_LIST_PAGE_SIZE,
  fetchDockerSecretsPaged,
  type PaginatedSecretsResponse,
} from "@/lib/docker-paged-fetch";

export default async function ConsoleSecretsPage({
  params,
  searchParams,
}: {
  params: Promise<{ serverId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { serverId } = await params;
  const consoleTarget = parseConsoleServerSlug(serverId);
  if (consoleTarget == null) notFound();

  if (consoleTarget === "local") {
    return (
      <div className="glass-panel rounded-xl border border-border p-6 space-y-3 max-w-xl">
        <p className="text-sm text-foreground/90">
          This platform does not run Docker on the API host. Swarm secrets are listed per remote deploy server.
        </p>
        <p className="text-sm text-muted-foreground">
          Open{" "}
          <Link href="/secrets" className="text-primary hover:underline">
            /secrets
          </Link>{" "}
          or use <span className="font-mono text-xs">/console/&lt;remote id&gt;/secrets</span> (numeric server id).
        </p>
      </div>
    );
  }

  const remoteServerId = consoleTarget;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  let data: PaginatedSecretsResponse | null = null;
  let error: string | null = null;
  try {
    data = await fetchDockerSecretsPaged(remoteServerId, page, DOCKER_LIST_PAGE_SIZE, q);
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
