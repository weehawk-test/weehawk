import { API_BASE } from "./api";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
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

export function registryLoginApi(body: RegistryLoginPayload) {
  return request<{ success: boolean; providerUrl: string }>("/registry/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function registryVerifyApi(body: RegistryLoginPayload) {
  return request<{ success: boolean; message: string }>(
    "/registry/verify-connection",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function registryLogoutApi(body: RegistryLogoutPayload) {
  return request<{ success: boolean; providerUrl: string; output?: string }>(
    "/registry/logout",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}
