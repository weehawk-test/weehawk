import { DockerVolumesClient } from "./volumes-client";
import {
  DOCKER_LIST_PAGE_SIZE,
  fetchDockerVolumesPaged,
  type PaginatedVolumesResponse,
} from "@/lib/docker-paged-fetch";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  let data: PaginatedVolumesResponse | null = null;
  let error: string | null = null;
  try {
    data = await fetchDockerVolumesPaged(page, DOCKER_LIST_PAGE_SIZE, q);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return <DockerVolumesClient data={data} error={error} urlPage={page} urlQ={q} />;
}
