import { DockerSecretsClient } from "./secrets-client";
import {
  DOCKER_LIST_PAGE_SIZE,
  fetchDockerSecretsPaged,
  type PaginatedSecretsResponse,
} from "@/lib/docker-paged-fetch";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
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
