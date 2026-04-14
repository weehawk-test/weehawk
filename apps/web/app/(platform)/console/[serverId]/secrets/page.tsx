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

  if (consoleTarget !== "local") {
    return (
      <div className="glass-panel rounded-xl border border-border p-6 space-y-3">
        <p className="text-sm text-foreground/90">
          Docker Swarm secrets are managed globally from the platform secrets page, not from per-server remote
          console views.
        </p>
        <p className="text-sm text-muted-foreground">
          Open{" "}
          <Link href="/secrets" className="text-primary hover:underline">
            /secrets
          </Link>{" "}
          to list and create secrets.
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  let data: PaginatedSecretsResponse | null = null;
  let error: string | null = null;
  try {
    data = await fetchDockerSecretsPaged(page, DOCKER_LIST_PAGE_SIZE, q);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return <DockerSecretsClient data={data} error={error} urlPage={page} urlQ={q} />;
}
