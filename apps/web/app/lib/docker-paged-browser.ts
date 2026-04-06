/**
 * Browser-side paged Docker monitor fetches (uses {@link API_BASE}, no SSR `API_URL`).
 */
import { API_BASE } from "./api";
import type {
  PaginatedContainersResponse,
  PaginatedImagesResponse,
  PaginatedNetworksResponse,
  PaginatedServicesResponse,
  PaginatedVolumesResponse,
} from "./docker-paged-fetch";

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

function buildQuery(page: number, pageSize: number, q: string): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const t = q.trim();
  if (t) params.set("q", t);
  return params.toString();
}

async function fetchPaged<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseError(text || res.statusText));
  }
  return JSON.parse(text) as T;
}

export async function fetchDockerContainersPagedBrowser(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedContainersResponse> {
  return fetchPaged(`/api/docker-monitor/containers/paged?${buildQuery(page, pageSize, q)}`);
}

export async function fetchDockerImagesPagedBrowser(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedImagesResponse> {
  return fetchPaged(`/api/docker-monitor/images/paged?${buildQuery(page, pageSize, q)}`);
}

export async function fetchDockerServicesPagedBrowser(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedServicesResponse> {
  return fetchPaged(`/api/docker-monitor/services/paged?${buildQuery(page, pageSize, q)}`);
}

export async function fetchDockerVolumesPagedBrowser(
  page: number,
  pageSize: number,
  q: string,
  includeSizes = true,
): Promise<PaginatedVolumesResponse> {
  const base = buildQuery(page, pageSize, q);
  const qs = includeSizes ? `${base}&includeSizes=true` : base;
  return fetchPaged(`/api/docker-monitor/volumes/paged?${qs}`);
}

export async function fetchDockerNetworksPagedBrowser(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedNetworksResponse> {
  return fetchPaged(`/api/docker-monitor/networks/paged?${buildQuery(page, pageSize, q)}`);
}
