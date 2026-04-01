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

export async function fetchDockerContainersPaged(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedContainersResponse> {
  const qs = buildQuery(page, pageSize, q);
  return fetchPaged<PaginatedContainersResponse>(`/docker-monitor/containers/paged?${qs}`);
}

export async function fetchDockerImagesPaged(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedImagesResponse> {
  const qs = buildQuery(page, pageSize, q);
  return fetchPaged<PaginatedImagesResponse>(`/docker-monitor/images/paged?${qs}`);
}

export async function fetchDockerServicesPaged(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedServicesResponse> {
  const qs = buildQuery(page, pageSize, q);
  return fetchPaged<PaginatedServicesResponse>(`/docker-monitor/services/paged?${qs}`);
}

export async function fetchDockerVolumesPaged(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedVolumesResponse> {
  const qs = buildQuery(page, pageSize, q);
  return fetchPaged<PaginatedVolumesResponse>(`/docker-monitor/volumes/paged?${qs}`);
}

export async function fetchDockerNetworksPaged(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedNetworksResponse> {
  const qs = buildQuery(page, pageSize, q);
  return fetchPaged<PaginatedNetworksResponse>(`/docker-monitor/networks/paged?${qs}`);
}

export async function fetchDockerSecretsPaged(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedSecretsResponse> {
  const qs = buildQuery(page, pageSize, q);
  return fetchPaged<PaginatedSecretsResponse>(`/docker-secrets/paged?${qs}`);
}

export const DOCKER_LIST_PAGE_SIZE = 10;
