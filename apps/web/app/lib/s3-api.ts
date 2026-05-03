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

function appendOrgParam(path: string, organizationPublicId?: string | null): string {
  const o = organizationPublicId?.trim();
  if (!o) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}organizationPublicId=${encodeURIComponent(o)}`;
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
  organizationPublicId?: string;
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

export function listS3ProfilesApi(organizationPublicId?: string | null) {
  return request<S3ProfilePublic[]>(appendOrgParam("/api/s3/profiles", organizationPublicId));
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

export function deleteS3ProfileApi(profileId: string, organizationPublicId?: string | null) {
  return request<{ success: boolean; publicId: string }>(
    appendOrgParam(`/api/s3/profiles/${encodeURIComponent(profileId)}`, organizationPublicId),
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
  opts?: { prefix?: string; continuationToken?: string; organizationPublicId?: string | null },
) {
  const q = new URLSearchParams();
  if (opts?.prefix !== undefined && opts.prefix !== "") q.set("prefix", opts.prefix);
  if (opts?.continuationToken) q.set("continuationToken", opts.continuationToken);
  const org = opts?.organizationPublicId?.trim();
  if (org) q.set("organizationPublicId", org);
  const qs = q.toString();
  return request<S3BucketListResponse>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/objects${qs ? `?${qs}` : ""}`,
  );
}

export function deleteS3ObjectApi(
  profileId: string,
  key: string,
  organizationPublicId?: string | null,
) {
  return request<{ success: boolean; key: string }>(
    appendOrgParam(
      `/api/s3/profiles/${encodeURIComponent(profileId)}/objects/delete`,
      organizationPublicId,
    ),
    { method: "POST", body: JSON.stringify({ key }) },
  );
}

export function deleteS3ObjectsBatchApi(
  profileId: string,
  keys: string[],
  organizationPublicId?: string | null,
) {
  return request<{
    deleted: string[];
    errors: { key: string; message: string }[];
  }>(
    appendOrgParam(
      `/api/s3/profiles/${encodeURIComponent(profileId)}/objects/delete-batch`,
      organizationPublicId,
    ),
    {
      method: "POST",
      body: JSON.stringify({ keys }),
    },
  );
}

export type S3PrefixSummaryResponse = {
  objectCount: number;
  totalSize: number;
  lastModified: string | null;
  isPartialSummary: boolean;
};

export function getPrefixSummaryApi(
  profileId: string,
  prefix: string,
  organizationPublicId?: string | null,
) {
  const q = new URLSearchParams({ prefix });
  const org = organizationPublicId?.trim();
  if (org) q.set("organizationPublicId", org);
  return request<S3PrefixSummaryResponse>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/prefix-summary?${q.toString()}`,
  );
}

export function deleteS3PrefixApi(
  profileId: string,
  prefix: string,
  organizationPublicId?: string | null,
) {
  return request<{
    deletedCount: number;
    errors: { key: string; message: string }[];
  }>(
    appendOrgParam(
      `/api/s3/profiles/${encodeURIComponent(profileId)}/objects/delete-prefix`,
      organizationPublicId,
    ),
    {
      method: "POST",
      body: JSON.stringify({ prefix }),
    },
  );
}

export function createS3FolderApi(
  profileId: string,
  key: string,
  organizationPublicId?: string | null,
) {
  return request<{ bucket: string; key: string }>(
    appendOrgParam(
      `/api/s3/profiles/${encodeURIComponent(profileId)}/objects/mkdir`,
      organizationPublicId,
    ),
    {
      method: "POST",
      body: JSON.stringify({ key }),
    },
  );
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
  opts?: {
    contentType?: string;
    expiresInSeconds?: number;
    organizationPublicId?: string | null;
  },
): Promise<S3PresignPutResponse> {
  return request<S3PresignPutResponse>(
    appendOrgParam(
      `/api/s3/profiles/${encodeURIComponent(profileId)}/objects/presign-put`,
      opts?.organizationPublicId,
    ),
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

/**
 * Upload via the API (multipart). Avoids browser `fetch(presignedPutUrl)` failures (CORS, internal MinIO host).
 */
export async function uploadS3ObjectApi(
  profileId: string,
  key: string,
  file: File,
  organizationPublicId?: string | null,
) {
  const contentType =
    file.type ||
    (key.toLowerCase().endsWith(".gz") ? "application/gzip" : "application/octet-stream");
  const q = new URLSearchParams({ key, contentType });
  const org = organizationPublicId?.trim();
  if (org) q.set("organizationPublicId", org);
  const url = `${API_BASE}/api/s3/profiles/${encodeURIComponent(profileId)}/objects/upload?${q.toString()}`;
  const form = new FormData();
  form.append("file", file, file.name || "upload.bin");
  const res = await authFetch("cookie-session", url, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseErrorMessage(text || res.statusText || "S3 upload failed"));
  }
  if (!text.trim()) {
    return { bucket: "", key };
  }
  return JSON.parse(text) as { bucket: string; key: string };
}

export type S3PresignGetResponse = {
  url: string;
  bucket: string;
  key: string;
  expiresIn: number;
};

export async function presignS3GetApi(
  profileId: string,
  key: string,
  expiresInSeconds?: number,
  organizationPublicId?: string | null,
) {
  const q = new URLSearchParams({ key });
  if (expiresInSeconds != null) q.set("expiresInSeconds", String(expiresInSeconds));
  const org = organizationPublicId?.trim();
  if (org) q.set("organizationPublicId", org);
  return request<S3PresignGetResponse>(
    `/api/s3/profiles/${encodeURIComponent(profileId)}/presign-get?${q.toString()}`,
  );
}

/**
 * Download object bytes via the API (streams from S3 on the server).
 * Avoids browser `fetch(presignedUrl)` failures: CORS on the bucket, mixed content,
 * or presigned URLs pointing at hosts only reachable from the API (e.g. internal MinIO).
 */
export async function downloadS3ObjectBlob(
  profileId: string,
  key: string,
  organizationPublicId?: string | null,
): Promise<Blob> {
  const q = new URLSearchParams({ key });
  const org = organizationPublicId?.trim();
  if (org) q.set("organizationPublicId", org);
  const url = `${API_BASE}/api/s3/profiles/${encodeURIComponent(profileId)}/download?${q.toString()}`;
  const res = await authFetch("cookie-session", url, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "*/*" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorMessage(text || res.statusText));
  }
  return res.blob();
}
