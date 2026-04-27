import { buildServerApiCookieHeaders } from "./server-cookie-headers";
import type { WebhookDetail, WebhookListItem } from "./webhooks-api";
import type { CronJobDetail, CronJobListItem } from "./cron-jobs-api";
import type { Project, Service } from "./schema";
import type { NotificationChannel } from "./notifications-api";
import type { S3ProfilePublic, S3BucketListResponse, S3PrefixSummaryResponse } from "./s3-api";
import type { RemoteServerRow } from "./remote-servers-api";
import type { TraefikSettingsPayload } from "./traefik-api";
import type { PaginatedSecretsResponse } from "./docker-paged-fetch";
import type { GitSettingsPublic } from "./git-api";
import {
  mapApiServiceToService,
  parseServicesPageResponse,
  SERVICES_PAGE_SIZE,
  type ServicesPageResponse,
} from "./services-api";
import {
  mapApiProjectToProject,
  parseProjectsPageResponse,
  PROJECTS_PAGE_SIZE,
  type ProjectsPageResponse,
} from "./projects-api";
import { getServerApiBase } from "./server-api";
import { getServerApiKey } from "./server-api-key";

const SERVICE_RUNTIME_SSR_TIMEOUT_MS = 1_200;

async function cookieHeaders(): Promise<HeadersInit> {
  const out = new Headers(await buildServerApiCookieHeaders());
  const apiKey = getServerApiKey();
  if (apiKey) out.set("X-Weehawk-Api-Key", apiKey);
  if (!out.has("Accept")) out.set("Accept", "application/json");
  return out;
}

function apiBase(): string {
  return getServerApiBase();
}

/** Server-only: forwards the browser Cookie header to the API (no client Network tab). */
export async function fetchWebhookSSR(id: string): Promise<WebhookDetail | null> {
  const res = await fetch(`${apiBase()}/api/webhooks/${encodeURIComponent(id)}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Omit<WebhookDetail, "triggerType" | "cronExpression">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    remoteTriggerUrl: data.remoteTriggerUrl ?? null,
    hooksPublicHost: data.hooksPublicHost ?? null,
    remoteTriggerUrlScheme: "https",
    triggerType: "webhook",
    cronExpression: null,
  };
}

export async function fetchWebhooksSSR(): Promise<WebhookListItem[]> {
  const res = await fetch(`${apiBase()}/api/webhooks`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Omit<WebhookListItem, "triggerType" | "cronExpression">[];
  return data.map((w) => ({
    ...w,
    publicId:
      w.publicId == null || String(w.publicId).trim() === "" ? undefined : String(w.publicId),
    remoteTriggerUrl: w.remoteTriggerUrl ?? null,
    hooksPublicHost: w.hooksPublicHost ?? null,
    remoteTriggerUrlScheme: "https",
    triggerType: "webhook" as const,
    cronExpression: null,
  }));
}

export async function fetchCronJobSSR(id: string): Promise<CronJobDetail | null> {
  const res = await fetch(`${apiBase()}/api/cron-jobs/${encodeURIComponent(id)}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    triggerType: "cron",
  };
}

export async function fetchCronJobsSSR(): Promise<CronJobListItem[]> {
  const res = await fetch(`${apiBase()}/api/cron-jobs`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Omit<CronJobListItem, "triggerType">[];
  return data.map((j) => ({
    ...j,
    publicId:
      j.publicId == null || String(j.publicId).trim() === "" ? undefined : String(j.publicId),
    triggerType: "cron" as const,
  }));
}

export async function fetchProjectSSR(id: string): Promise<Project | null> {
  const res = await fetch(`${apiBase()}/api/projects/${encodeURIComponent(id)}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return mapApiProjectToProject(await res.json());
}

export async function fetchProjectsSSR(
  page = 1,
  q = "",
): Promise<ProjectsPageResponse> {
  const params = new URLSearchParams();
  params.set("page", String(Math.max(1, page)));
  params.set("limit", String(PROJECTS_PAGE_SIZE));
  const trim = q.trim();
  if (trim) params.set("q", trim);
  const res = await fetch(`${apiBase()}/api/projects?${params.toString()}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || res.statusText || `HTTP ${res.status}`);
  }
  return parseProjectsPageResponse(text);
}

/** All services (no project filter). Used by webhook/cron create & edit pickers. */
export async function fetchServicesSSR(): Promise<Service[]> {
  const res = await fetch(`${apiBase()}/api/services`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => mapApiServiceToService(row));
}

export async function fetchServicesPageSSR(
  projectId: string,
  page = 1,
  q = "",
): Promise<ServicesPageResponse> {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  params.set("page", String(Math.max(1, page)));
  params.set("limit", String(SERVICES_PAGE_SIZE));
  const trim = q.trim();
  if (trim) params.set("q", trim);
  const res = await fetch(`${apiBase()}/api/services?${params.toString()}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || res.statusText || `HTTP ${res.status}`);
  }
  return parseServicesPageResponse(text);
}

export async function fetchServiceSSR(id: string): Promise<Service | null> {
  const res = await fetch(`${apiBase()}/api/services/${encodeURIComponent(id)}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return mapApiServiceToService(await res.json());
}

export async function fetchServiceRuntimeSSR(
  id: string,
): Promise<{ running: boolean } | null> {
  const timeoutSignal =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(SERVICE_RUNTIME_SSR_TIMEOUT_MS)
      : undefined;
  try {
    const res = await fetch(`${apiBase()}/api/services/${encodeURIComponent(id)}/runtime`, {
      headers: await cookieHeaders(),
      cache: "no-store",
      ...(timeoutSignal ? { signal: timeoutSignal } : {}),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { running?: boolean };
    return { running: j.running === true };
  } catch {
    return null;
  }
}

export async function fetchNotificationChannelsSSR(): Promise<NotificationChannel[]> {
  const res = await fetch(`${apiBase()}/api/notifications/channels`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json() as Promise<NotificationChannel[]>;
}

export async function fetchS3ProfilesSSR(): Promise<S3ProfilePublic[]> {
  const res = await fetch(`${apiBase()}/api/s3/profiles`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as S3ProfilePublic[];
}

export async function fetchRemoteServersSSR(): Promise<RemoteServerRow[]> {
  const res = await fetch(`${apiBase()}/api/remote-servers`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as RemoteServerRow[];
}

/** Server-only: paginated Docker secrets on remote host (accepts numeric id or publicId). */
export async function fetchDockerSecretsPagedSSR(
  remoteServerId: string | number,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedSecretsResponse> {
  const params = new URLSearchParams({
    remoteServerId: String(remoteServerId),
    page: String(Math.max(1, page)),
    pageSize: String(Math.max(1, pageSize)),
  });
  const t = q.trim();
  if (t) params.set("q", t);
  const res = await fetch(`${apiBase()}/api/docker-secrets/paged?${params.toString()}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || res.statusText || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as PaginatedSecretsResponse;
}

export async function fetchTraefikSettingsSSR(): Promise<TraefikSettingsPayload | null> {
  const res = await fetch(`${apiBase()}/api/traefik/settings`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as TraefikSettingsPayload;
}

/** Server-only: Git provider settings for Git/GitHub/GitLab screens. */
export async function fetchGitSettingsSSR(): Promise<GitSettingsPublic | null> {
  const res = await fetch(`${apiBase()}/api/git/settings`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as GitSettingsPublic;
}

/** Server-only: bucket listing at root prefix (no client Network tab on first paint). */
export async function fetchS3BucketObjectsSSR(
  profileId: string,
  prefix = "",
): Promise<S3BucketListResponse | null> {
  const q = new URLSearchParams();
  if (prefix) q.set("prefix", prefix);
  const qs = q.toString();
  const res = await fetch(
    `${apiBase()}/api/s3/profiles/${encodeURIComponent(profileId)}/objects${qs ? `?${qs}` : ""}`,
    { headers: await cookieHeaders(), cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as S3BucketListResponse;
}

/** Server-only: recursive prefix stats for folder rows. */
export async function fetchS3PrefixSummarySSR(
  profileId: string,
  folderPrefix: string,
): Promise<S3PrefixSummaryResponse | null> {
  const q = new URLSearchParams({ prefix: folderPrefix });
  const res = await fetch(
    `${apiBase()}/api/s3/profiles/${encodeURIComponent(profileId)}/prefix-summary?${q.toString()}`,
    { headers: await cookieHeaders(), cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as S3PrefixSummaryResponse;
}

