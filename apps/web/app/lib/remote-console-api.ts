import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";
import type {
  PaginatedContainersResponse,
  PaginatedImagesResponse,
  PaginatedNetworksResponse,
  PaginatedServicesResponse,
  PaginatedVolumesResponse,
} from "./docker-paged-fetch";

function nestErrorMessage(text: string, fallback: string): string {
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (typeof j.message === "string") return j.message;
    if (Array.isArray(j.message)) return j.message.join(", ");
  } catch {
    /* keep */
  }
  return text.trim() || fallback;
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

async function authJson<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(accessToken, `${API_BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return JSON.parse(text) as T;
}

export async function fetchRemoteConsoleContainersPaged(
  accessToken: string,
  serverId: string,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedContainersResponse> {
  const qs = buildQuery(page, pageSize, q);
  return authJson(
    accessToken,
    `/api/remote-servers/${serverId}/console/containers/paged?${qs}`,
  );
}

export async function fetchRemoteConsoleImagesPaged(
  accessToken: string,
  serverId: string,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedImagesResponse> {
  const qs = buildQuery(page, pageSize, q);
  return authJson(
    accessToken,
    `/api/remote-servers/${serverId}/console/images/paged?${qs}`,
  );
}

export async function fetchRemoteConsoleServicesPaged(
  accessToken: string,
  serverId: string,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedServicesResponse> {
  const qs = buildQuery(page, pageSize, q);
  return authJson(
    accessToken,
    `/api/remote-servers/${serverId}/console/services/paged?${qs}`,
  );
}

export async function fetchRemoteConsoleVolumesPaged(
  accessToken: string,
  serverId: string,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedVolumesResponse> {
  const qs = buildQuery(page, pageSize, q);
  return authJson(
    accessToken,
    `/api/remote-servers/${serverId}/console/volumes/paged?${qs}`,
  );
}

export async function fetchRemoteConsoleNetworksPaged(
  accessToken: string,
  serverId: string,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedNetworksResponse> {
  const qs = buildQuery(page, pageSize, q);
  return authJson(
    accessToken,
    `/api/remote-servers/${serverId}/console/networks/paged?${qs}`,
  );
}

export async function fetchRemoteConsoleContainerLogs(
  accessToken: string,
  serverId: string,
  containerId: string,
  tail: number,
): Promise<string> {
  const q = new URLSearchParams({ tail: String(tail) });
  const j = await authJson<{ logs?: string }>(
    accessToken,
    `/api/remote-servers/${serverId}/console/containers/${encodeURIComponent(containerId)}/logs?${q}`,
  );
  return j.logs ?? "";
}

export async function fetchRemoteConsoleServiceLogs(
  accessToken: string,
  serverId: string,
  serviceId: string,
  tail: number,
): Promise<string> {
  const q = new URLSearchParams({ tail: String(tail) });
  const j = await authJson<{ logs?: string }>(
    accessToken,
    `/api/remote-servers/${serverId}/console/services/${encodeURIComponent(serviceId)}/logs?${q}`,
  );
  return j.logs ?? "";
}

async function authDelete(accessToken: string, path: string): Promise<void> {
  const res = await authFetch(accessToken, `${API_BASE}${path}`, { method: "DELETE" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
}

export async function deleteRemoteConsoleContainer(
  accessToken: string,
  serverId: string,
  idOrName: string,
  force = false,
): Promise<void> {
  const qs = force ? "?force=true" : "";
  await authDelete(
    accessToken,
    `/api/remote-servers/${serverId}/console/containers/${encodeURIComponent(idOrName)}${qs}`,
  );
}

export async function deleteRemoteConsoleImage(
  accessToken: string,
  serverId: string,
  ref: string,
): Promise<void> {
  await authDelete(
    accessToken,
    `/api/remote-servers/${serverId}/console/images?ref=${encodeURIComponent(ref)}`,
  );
}

export async function deleteRemoteConsoleVolume(
  accessToken: string,
  serverId: string,
  name: string,
  force = false,
): Promise<void> {
  const qs = force ? "?force=true" : "";
  await authDelete(
    accessToken,
    `/api/remote-servers/${serverId}/console/volumes/${encodeURIComponent(name)}${qs}`,
  );
}

export async function deleteRemoteConsoleNetwork(
  accessToken: string,
  serverId: string,
  idOrName: string,
): Promise<void> {
  await authDelete(
    accessToken,
    `/api/remote-servers/${serverId}/console/networks/${encodeURIComponent(idOrName)}`,
  );
}

export async function deleteRemoteConsoleService(
  accessToken: string,
  serverId: string,
  idOrName: string,
  force = false,
): Promise<void> {
  const qs = force ? "?force=true" : "";
  await authDelete(
    accessToken,
    `/api/remote-servers/${serverId}/console/services/${encodeURIComponent(idOrName)}${qs}`,
  );
}
