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

export type S3ProfilePayload = {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  /** Omit or leave empty when updating to keep the stored secret. */
  secretAccessKey?: string;
  forcePathStyle?: boolean;
};

export type S3ProfilePublic = {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  /** Set by API; older responses may omit (client falls back to updatedAt). */
  createdAt?: string;
  updatedAt: string;
  secretAccessKeyMasked: string;
};

export function listS3ProfilesApi() {
  return request<S3ProfilePublic[]>("/s3/profiles");
}

export function saveS3ProfileApi(body: S3ProfilePayload) {
  return request<{ success: boolean; profile: S3ProfilePublic }>("/s3/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function testS3ConnectionApi(body: S3ProfilePayload) {
  return request<{ success: boolean; message: string }>("/s3/test-connection", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteS3ProfileApi(name: string) {
  return request<{ success: boolean; name: string }>(
    `/s3/profiles/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}
