import { API_BASE } from "./api";
import type { DockerSecretListItem } from "./schema";
import type { PaginatedSecretsResponse } from "./docker-paged-fetch";

function parseJsonError(text: string): string {
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (typeof j.message === "string") return j.message;
    if (Array.isArray(j.message)) return j.message.join(", ");
  } catch {
    /* ignore */
  }
  return text;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(parseJsonError(text || res.statusText));
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function pickStr(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).length) return String(v);
  }
  return "";
}

export function mapDockerSecretLsRow(r: Record<string, unknown>, index: number): DockerSecretListItem {
  const id = pickStr(r, "ID", "Id") || `secret-${index}`;
  const name = pickStr(r, "Name");
  const createdAt = pickStr(r, "createdAt", "CreatedAt", "Created") || new Date().toISOString();
  return { id, name, createdAt };
}

export async function listDockerSecrets(): Promise<DockerSecretListItem[]> {
  const raw = await request<unknown[]>("/api/docker-secrets");
  if (!Array.isArray(raw)) return [];
  return raw.map((row, i) => mapDockerSecretLsRow(row as Record<string, unknown>, i));
}

export async function fetchDockerSecretsPagedApi(
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedSecretsResponse> {
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    pageSize: String(Math.max(1, pageSize)),
  });
  const t = q.trim();
  if (t) params.set("q", t);
  return request<PaginatedSecretsResponse>(`/api/docker-secrets/paged?${params.toString()}`);
}

export async function createDockerSecretApi(body: { name: string; value: string }) {
  return request<{ success: boolean; name: string }>("/api/docker-secrets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteDockerSecretApi(name: string, force = false) {
  const enc = encodeURIComponent(name);
  const qs = force ? "?force=true" : "";
  return request<{ success: boolean }>(`/api/docker-secrets/${enc}${qs}`, { method: "DELETE" });
}

/** Docker secrets are immutable; rotation = rm + create with same name. */
export async function replaceDockerSecretApi(name: string, value: string) {
  await deleteDockerSecretApi(name);
  await createDockerSecretApi({ name, value });
}

export async function bulkImportSecretsApi(envText: string) {
  return request<{ message: string; created: string[]; failed: Array<{ key: string; error: string }> }>(
    "/api/docker-secrets/bulk-import",
    { method: "POST", body: JSON.stringify({ envText }) },
  );
}
