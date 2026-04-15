import type { DockerContainer, DockerImage, DockerNetwork, DockerService, DockerVolume } from "./docker-api";
import type { DockerSecretListItem } from "./schema";
import { getServerApiBase } from "./server-api";

function parseError(text: string): string {
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (typeof j.message === "string") return j.message;
    if (Array.isArray(j.message)) return j.message.join(", ");
  } catch {
    /* ignore */
  }
  return text.trim() || "Request failed";
}

async function fetchPaged<T>(path: string): Promise<T> {
  const base = getServerApiBase();
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseError(text || res.statusText));
  }
  return JSON.parse(text) as T;
}

export interface PaginatedContainersResponse {
  items: DockerContainer[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
  counts: {
    running: number;
    stopped: number;
    exited: number;
    all: number;
  };
}

export interface PaginatedServicesResponse {
  items: DockerService[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
  counts: {
    running: number;
    stopped: number;
    degraded: number;
    all: number;
  };
}

export interface PaginatedImagesResponse {
  items: DockerImage[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

export interface PaginatedVolumesResponse {
  items: DockerVolume[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

export interface PaginatedNetworksResponse {
  items: DockerNetwork[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

export interface PaginatedSecretsResponse {
  items: DockerSecretListItem[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

function buildQuery(page: number, pageSize: number, q: string): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const t = q.trim();
  if (t) params.set("q", t);
  return params.toString();
}

export async function fetchDockerSecretsPaged(
  remoteServerId: string | number,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedSecretsResponse> {
  const qs = buildQuery(page, pageSize, q);
  const rid = `remoteServerId=${encodeURIComponent(String(remoteServerId))}`;
  return fetchPaged<PaginatedSecretsResponse>(`/api/docker-secrets/paged?${rid}&${qs}`);
}

export const DOCKER_LIST_PAGE_SIZE = 10;
