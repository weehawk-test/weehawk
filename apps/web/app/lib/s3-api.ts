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
  publicId?: string;
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

export function s3ProfileRouteId(profile: { publicId?: string | null; name: string }): string {
  const p = profile.publicId?.trim();
  if (p) return p;
  return profile.name.trim();
}

export function listS3ProfilesApi() {
  return request<S3ProfilePublic[]>("/api/s3/profiles");
}

export function saveS3ProfileApi(body: S3ProfilePayload) {
  return request<{ success: boolean; profile: S3ProfilePublic }>("/api/s3/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type S3TestConnectionPayload = S3ProfilePayload & {
  remoteServerId: number;
};

export function testS3ConnectionApi(body: S3TestConnectionPayload) {
  return request<{
    success: boolean;
    message: string;
    remoteServerId: number;
  }>("/api/s3/test-connection", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteS3ProfileApi(profileId: string) {
  return request<{ success: boolean; publicId: string }>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}`,
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
  profileId: string,
  opts?: { prefix?: string; continuationToken?: string },
) {
  const q = new URLSearchParams();
  if (opts?.prefix !== undefined && opts.prefix !== "") q.set("prefix", opts.prefix);
  if (opts?.continuationToken) q.set("continuationToken", opts.continuationToken);
  const qs = q.toString();
  return request<S3BucketListResponse>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/objects${qs ? `?${qs}` : ""}`,
  );
}

export function deleteS3ObjectApi(profileId: string, key: string) {
  return request<{ success: boolean; key: string }>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/objects/delete`,
    { method: "POST", body: JSON.stringify({ key }) },
  );
}

export function deleteS3ObjectsBatchApi(profileId: string, keys: string[]) {
  return request<{
    deleted: string[];
    errors: { key: string; message: string }[];
  }>(`/api/s3/profiles/${encodeURIComponent(profileId)}/objects/delete-batch`, {
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

export function getPrefixSummaryApi(profileId: string, prefix: string) {
  const q = new URLSearchParams({ prefix });
  return request<S3PrefixSummaryResponse>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/prefix-summary?${q.toString()}`,
  );
}

export function deleteS3PrefixApi(profileId: string, prefix: string) {
  return request<{
    deletedCount: number;
    errors: { key: string; message: string }[];
  }>(`/api/s3/profiles/${encodeURIComponent(profileId)}/objects/delete-prefix`, {
    method: "POST",
    body: JSON.stringify({ prefix }),
  });
}

export type S3PresignPutResponse = {
  url: string;
  bucket: string;
  key: string;
  expiresIn: number;
  contentType: string;
};

export async function presignS3PutApi(
  profileId: string,
  key: string,
  opts?: { contentType?: string; expiresInSeconds?: number },
): Promise<S3PresignPutResponse> {
  return request<S3PresignPutResponse>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/objects/presign-put`,
    {
      method: "POST",
      body: JSON.stringify({
        key,
        contentType: opts?.contentType,
        expiresInSeconds: opts?.expiresInSeconds,
      }),
    },
  );
}

/** Upload bytes directly to the bucket using a presigned URL (API never stores the file). */
export async function uploadS3ObjectApi(profileId: string, key: string, file: File) {
  const contentType =
    file.type ||
    (key.toLowerCase().endsWith(".gz") ? "application/gzip" : "application/octet-stream");
  const presign = await presignS3PutApi(profileId, key, { contentType });
  const put = await fetch(presign.url, {
    method: "PUT",
    headers: { "Content-Type": presign.contentType },
    body: file,
    cache: "no-store",
  });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(text || put.statusText || "S3 upload failed");
  }
  return { bucket: presign.bucket, key: presign.key };
}

export type S3PresignGetResponse = {
  url: string;
  bucket: string;
  key: string;
  expiresIn: number;
};

export async function presignS3GetApi(profileId: string, key: string, expiresInSeconds?: number) {
  const q = new URLSearchParams({ key });
  if (expiresInSeconds != null) q.set("expiresInSeconds", String(expiresInSeconds));
  return request<S3PresignGetResponse>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/presign-get?${q.toString()}`,
  );
}

export async function downloadS3ObjectBlob(profileId: string, key: string): Promise<Blob> {
  const { url } = await presignS3GetApi(profileId, key);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorMessage(text || res.statusText));
  }
  return res.blob();
}
