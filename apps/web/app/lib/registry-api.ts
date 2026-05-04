import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

type ApiErrorShape = { message?: string | string[] };

function parseErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as ApiErrorShape;
    if (typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.join(", ");
  } catch {
    // Keep raw text fallback.
  }
  return text;
}

async function request<T>(accessToken: string | null, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await authFetch(accessToken, `${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseErrorMessage(text || res.statusText));
  }

  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export type RegistryLoginPayload = {
  providerUrl: string;
  username: string;
  password: string;
};

export type RegistryLogoutPayload = {
  providerUrl: string;
};

export function registryLoginApi(accessToken: string | null, body: RegistryLoginPayload) {
  return request<{ success: boolean; providerUrl: string }>(accessToken, "/api/registry/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function registryVerifyApi(accessToken: string | null, body: RegistryLoginPayload) {
  return request<{ success: boolean; message: string }>(
    accessToken,
    "/api/registry/verify-connection",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function registryLogoutApi(accessToken: string | null, body: RegistryLogoutPayload) {
  return request<{ success: boolean; providerUrl: string; output?: string }>(
    accessToken,
    "/api/registry/logout",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export type RegistryAccountRow = {
  id: number;
  name: string;
  providerUrl: string;
  username: string;
  lastVerifiedAt: string | null;
};

function registryAccountsQuery(organizationPublicId: string): string {
  const t = organizationPublicId.trim();
  if (!t) throw new Error("organizationPublicId is required");
  return `?organizationPublicId=${encodeURIComponent(t)}`;
}

export async function fetchRegistryAccounts(
  accessToken: string,
  organizationPublicId: string,
): Promise<RegistryAccountRow[]> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/registry/accounts${registryAccountsQuery(organizationPublicId)}`,
    { method: "GET" },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseErrorMessage(text || res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data as RegistryAccountRow[];
}

export type CreateRegistryAccountPayload = {
  name: string;
  providerUrl: string;
  username: string;
  password: string;
};

export async function createRegistryAccountApi(
  accessToken: string,
  organizationPublicId: string,
  body: CreateRegistryAccountPayload,
): Promise<RegistryAccountRow> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/registry/accounts${registryAccountsQuery(organizationPublicId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseErrorMessage(text || res.statusText || `HTTP ${res.status}`));
  }
  return JSON.parse(text) as RegistryAccountRow;
}

export async function deleteRegistryAccountApi(
  accessToken: string,
  organizationPublicId: string,
  id: number,
): Promise<void> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/registry/accounts/${id}${registryAccountsQuery(organizationPublicId)}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorMessage(text || res.statusText || `HTTP ${res.status}`));
  }
}
