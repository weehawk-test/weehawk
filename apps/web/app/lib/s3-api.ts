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
    credentials: typeof window !== "undefined" ? "include" : init?.credentials,
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

export type S3BucketListResponse = {
  bucket: string;
  prefix: string;
  folders: { prefix: string; name: string }[];
  objects: { key: string; name: string; size: number; lastModified: string }[];
  isTruncated: boolean;
  continuationToken?: string;
};

export function listS3BucketObjectsApi(
  profileName: string,
  opts?: { prefix?: string; continuationToken?: string },
) {
  const q = new URLSearchParams();
  if (opts?.prefix !== undefined && opts.prefix !== "") q.set("prefix", opts.prefix);
  if (opts?.continuationToken) q.set("continuationToken", opts.continuationToken);
  const qs = q.toString();
  return request<S3BucketListResponse>(
    `/s3/profiles/${encodeURIComponent(profileName)}/objects${qs ? `?${qs}` : ""}`,
  );
}

export function deleteS3ObjectApi(profileName: string, key: string) {
  return request<{ success: boolean; key: string }>(
    `/s3/profiles/${encodeURIComponent(profileName)}/objects/delete`,
    { method: "POST", body: JSON.stringify({ key }) },
  );
}

export function deleteS3ObjectsBatchApi(profileName: string, keys: string[]) {
  return request<{
    deleted: string[];
    errors: { key: string; message: string }[];
  }>(`/s3/profiles/${encodeURIComponent(profileName)}/objects/delete-batch`, {
    method: "POST",
    body: JSON.stringify({ keys }),
  });
}

export type S3PrefixSummaryResponse = {
  objectCount: number;
  totalSize: number;
  lastModified: string | null;
  isPartialSummary: boolean;
};

export function getPrefixSummaryApi(profileName: string, prefix: string) {
  const q = new URLSearchParams({ prefix });
  return request<S3PrefixSummaryResponse>(
    `/s3/profiles/${encodeURIComponent(profileName)}/prefix-summary?${q.toString()}`,
  );
}

export function deleteS3PrefixApi(profileName: string, prefix: string) {
  return request<{
    deletedCount: number;
    errors: { key: string; message: string }[];
  }>(`/s3/profiles/${encodeURIComponent(profileName)}/objects/delete-prefix`, {
    method: "POST",
    body: JSON.stringify({ prefix }),
  });
}

export async function uploadS3ObjectApi(profileName: string, key: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("key", key);
  const res = await fetch(
    `${API_BASE}/s3/profiles/${encodeURIComponent(profileName)}/objects/upload`,
    {
      method: "POST",
      body: fd,
      credentials: "include",
      cache: "no-store",
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseErrorMessage(text || res.statusText));
  }
  return JSON.parse(text) as { bucket: string; key: string };
}

export async function downloadS3ObjectBlob(profileName: string, key: string): Promise<Blob> {
  const res = await fetch(
    `${API_BASE}/s3/profiles/${encodeURIComponent(profileName)}/download?${new URLSearchParams({ key })}`,
    { credentials: "include", cache: "no-store" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorMessage(text || res.statusText));
  }
  return res.blob();
}
