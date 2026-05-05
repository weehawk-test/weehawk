import { buildServerApiCookieHeaders } from "./server-cookie-headers";
import type { WebhookDetail, WebhookListItem } from "./webhooks-api";
import type { CronJobDetail, CronJobListItem } from "./cron-jobs-api";
import type { Project, Service } from "./schema";
import type {
  NotificationChannel,
  PaginatedNotificationChannelsResponse,
} from "./notifications-api";
import type { S3ProfilePublic, S3BucketListResponse, S3PrefixSummaryResponse } from "./s3-api";
import type { RemoteServerRow } from "./remote-servers-api";
import type { TraefikSettingsPayload } from "./traefik-api";
import type { PaginatedSecretsResponse } from "./docker-paged-fetch";
import type { GitSettingsPublic } from "./git-api";
import type {
  OrganizationAuditLogEntry,
  OrganizationAuditLogPage,
  OrganizationMemberPublic,
  OrganizationProjectListItem,
  OrganizationPublic,
} from "./organizations-types";
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
import { parseWorkspacePermissions } from "./org-workspace-permissions";

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
export async function fetchWebhookSSR(
  id: string,
  organizationPublicId?: string | null,
): Promise<WebhookDetail | null> {
  const org = organizationPublicId?.trim();
  if (!org) return null;
  const q = `?organizationPublicId=${encodeURIComponent(org)}`;
  const res = await fetch(`${apiBase()}/api/webhooks/${encodeURIComponent(id)}${q}`, {
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

export async function fetchWebhooksSSR(
  organizationPublicId?: string | null,
): Promise<WebhookListItem[]> {
  const org = organizationPublicId?.trim();
  if (!org) return [];
  const q = `?organizationPublicId=${encodeURIComponent(org)}`;
  const res = await fetch(`${apiBase()}/api/webhooks${q}`, {
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

export async function fetchCronJobSSR(
  id: string,
  organizationPublicId?: string | null,
): Promise<CronJobDetail | null> {
  const org = organizationPublicId?.trim();
  if (!org) return null;
  const q = `?organizationPublicId=${encodeURIComponent(org)}`;
  const res = await fetch(`${apiBase()}/api/cron-jobs/${encodeURIComponent(id)}${q}`, {
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

export async function fetchCronJobsSSR(
  organizationPublicId?: string | null,
): Promise<CronJobListItem[]> {
  const org = organizationPublicId?.trim();
  if (!org) return [];
  const q = `?organizationPublicId=${encodeURIComponent(org)}`;
  const res = await fetch(`${apiBase()}/api/cron-jobs${q}`, {
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

export async function fetchProjectSSR(
  id: string,
  organizationPublicId?: string | null,
): Promise<Project | null> {
  const org = organizationPublicId?.trim();
  if (!org) return null;
  const q = `?organizationPublicId=${encodeURIComponent(org)}`;
  const res = await fetch(`${apiBase()}/api/projects/${encodeURIComponent(id)}${q}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return mapApiProjectToProject(await res.json());
}

export async function fetchProjectsSSR(
  page = 1,
  q = "",
  organizationPublicId?: string,
): Promise<ProjectsPageResponse> {
  const params = new URLSearchParams();
  params.set("page", String(Math.max(1, page)));
  params.set("limit", String(PROJECTS_PAGE_SIZE));
  const trim = q.trim();
  if (trim) params.set("q", trim);
  const org = organizationPublicId?.trim();
  if (!org) {
    throw new Error("organizationPublicId is required");
  }
  params.set("organizationPublicId", org);
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

export async function fetchNotificationChannelsSSR(
  organizationPublicId?: string | null,
): Promise<NotificationChannel[]> {
  const org = organizationPublicId?.trim();
  if (!org) return [];
  const q = `?organizationPublicId=${encodeURIComponent(org)}`;
  const res = await fetch(`${apiBase()}/api/notifications/channels${q}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json() as Promise<NotificationChannel[]>;
}

export async function fetchNotificationChannelsPagedSSR(
  page: number,
  pageSize: number,
  q: string,
  organizationPublicId?: string | null,
): Promise<PaginatedNotificationChannelsResponse> {
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    pageSize: String(Math.max(1, pageSize)),
  });
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  const org = organizationPublicId?.trim();
  if (!org) {
    throw new Error("organizationPublicId is required");
  }
  params.set("organizationPublicId", org);
  const res = await fetch(`${apiBase()}/api/notifications/channels/paged?${params.toString()}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || res.statusText || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as PaginatedNotificationChannelsResponse;
}

export async function fetchS3ProfilesSSR(
  organizationPublicId?: string | null,
): Promise<S3ProfilePublic[]> {
  const org = organizationPublicId?.trim();
  if (!org) return [];
  const q = `?organizationPublicId=${encodeURIComponent(org)}`;
  const res = await fetch(`${apiBase()}/api/s3/profiles${q}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as S3ProfilePublic[];
}

export async function fetchRemoteServersSSR(
  organizationPublicId?: string | null,
): Promise<RemoteServerRow[]> {
  const q =
    organizationPublicId != null && String(organizationPublicId).trim() !== ""
      ? `?organizationPublicId=${encodeURIComponent(String(organizationPublicId).trim())}`
      : "";
  const res = await fetch(`${apiBase()}/api/remote-servers${q}`, {
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

export async function fetchTraefikSettingsSSR(
  organizationPublicId: string,
): Promise<TraefikSettingsPayload | null> {
  const org = organizationPublicId.trim();
  if (!org) return null;
  const res = await fetch(
    `${apiBase()}/api/traefik/settings?organizationPublicId=${encodeURIComponent(org)}`,
    {
      headers: await cookieHeaders(),
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as TraefikSettingsPayload;
}

/** Server-only: Git provider settings for Git/GitHub/GitLab screens (organization-scoped). */
export async function fetchGitSettingsSSR(
  organizationPublicId: string,
): Promise<GitSettingsPublic | null> {
  const org = organizationPublicId.trim();
  if (!org) return null;
  const u = new URL(`${apiBase()}/api/git/settings`);
  u.searchParams.set("organizationPublicId", org);
  const res = await fetch(u.toString(), {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as GitSettingsPublic;
}

export async function fetchOrganizationsListSSR(): Promise<OrganizationPublic[]> {
  const res = await fetch(`${apiBase()}/api/organizations`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as Record<string, unknown>;
    const created = row.createdAt;
    let createdAt: string;
    if (created instanceof Date) createdAt = created.toISOString();
    else if (typeof created === "string") createdAt = created;
    else createdAt = new Date().toISOString();
    const mc = row.memberCount;
    const memberCount =
      typeof mc === "number" && Number.isFinite(mc) ? Math.max(1, Math.floor(mc)) : 1;
    return {
      publicId: String(row.publicId ?? ""),
      name: String(row.name ?? ""),
      isOwner: row.isOwner === true,
      createdAt,
      memberCount,
      workspacePermissions: parseWorkspacePermissions(row.workspacePermissions),
    };
  });
}

export async function fetchOrganizationMembersSSR(
  organizationPublicId: string,
): Promise<OrganizationMemberPublic[]> {
  const id = organizationPublicId.trim();
  if (!id) return [];
  const res = await fetch(`${apiBase()}/api/organizations/${encodeURIComponent(id)}/members`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as Record<string, unknown>;
    const joined = row.joinedAt;
    let joinedAt: string;
    if (joined instanceof Date) joinedAt = joined.toISOString();
    else if (typeof joined === "string") joinedAt = joined;
    else joinedAt = new Date().toISOString();
    return {
      email: String(row.email ?? ""),
      firstName: String(row.firstName ?? ""),
      lastName: String(row.lastName ?? ""),
      isOwner: row.isOwner === true,
      joinedAt,
      workspacePermissions: parseWorkspacePermissions(row.workspacePermissions),
    };
  });
}

function parseOrganizationAuditLogEntry(raw: unknown): OrganizationAuditLogEntry | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const created = row.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();
  const meta = row.metadata;
  const metadata =
    meta != null && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : null;
  return {
    id: typeof row.id === "number" ? row.id : Number(row.id ?? 0),
    action: String(row.action ?? ""),
    createdAt,
    actorUserId: typeof row.actorUserId === "number" ? row.actorUserId : Number(row.actorUserId ?? 0),
    actorEmail: String(row.actorEmail ?? ""),
    metadata,
  };
}

function emptyAuditLogPage(pageSize: number): OrganizationAuditLogPage {
  return { items: [], total: 0, page: 1, pageSize, totalPages: 0 };
}

/** Server-only: organization audit log (requires Management · Audit log or owner). */
export async function fetchOrganizationAuditLogSSR(
  organizationPublicId: string,
  opts?: { page?: number; pageSize?: number },
): Promise<OrganizationAuditLogPage> {
  const pageSize = opts?.pageSize ?? 12;
  const page = opts?.page ?? 1;
  const id = organizationPublicId.trim();
  if (!id) return emptyAuditLogPage(pageSize);

  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));
  const res = await fetch(
    `${apiBase()}/api/organizations/${encodeURIComponent(id)}/audit-log?${qs.toString()}`,
    {
      headers: await cookieHeaders(),
      cache: "no-store",
    },
  );
  if (!res.ok) return emptyAuditLogPage(pageSize);

  const data = (await res.json()) as unknown;
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const itemsRaw = obj.items;
    const items: OrganizationAuditLogEntry[] = [];
    if (Array.isArray(itemsRaw)) {
      for (const raw of itemsRaw) {
        const e = parseOrganizationAuditLogEntry(raw);
        if (e) items.push(e);
      }
    }
    const total = typeof obj.total === "number" ? obj.total : Number(obj.total ?? 0);
    const p = typeof obj.page === "number" ? obj.page : Number(obj.page ?? 1);
    const ps = typeof obj.pageSize === "number" ? obj.pageSize : Number(obj.pageSize ?? pageSize);
    const tp = typeof obj.totalPages === "number" ? obj.totalPages : Number(obj.totalPages ?? 0);
    return {
      items,
      total: Number.isFinite(total) ? total : 0,
      page: Number.isFinite(p) && p >= 1 ? p : 1,
      pageSize: Number.isFinite(ps) && ps >= 1 ? ps : pageSize,
      totalPages: Number.isFinite(tp) ? Math.max(0, tp) : 0,
    };
  }

  if (Array.isArray(data)) {
    const items: OrganizationAuditLogEntry[] = [];
    for (const raw of data) {
      const e = parseOrganizationAuditLogEntry(raw);
      if (e) items.push(e);
    }
    return {
      items,
      total: items.length,
      page: 1,
      pageSize: items.length || pageSize,
      totalPages: items.length > 0 ? 1 : 0,
    };
  }

  return emptyAuditLogPage(pageSize);
}

export async function fetchOrganizationProjectsSSR(
  organizationPublicId: string,
): Promise<OrganizationProjectListItem[]> {
  const id = organizationPublicId.trim();
  if (!id) return [];
  const res = await fetch(`${apiBase()}/api/organizations/${encodeURIComponent(id)}/projects`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as Record<string, unknown>;
    const created = row.createdAt;
    let createdAt: string;
    if (created instanceof Date) createdAt = created.toISOString();
    else if (typeof created === "string") createdAt = created;
    else createdAt = new Date().toISOString();
    const sc = row.serviceCount;
    const serviceCount =
      typeof sc === "number" && Number.isFinite(sc) ? Math.max(0, Math.floor(sc)) : 0;
    return {
      publicId: String(row.publicId ?? ""),
      name: String(row.name ?? ""),
      description: typeof row.description === "string" ? row.description : "",
      createdAt,
      serviceCount,
    };
  });
}

export async function fetchOrganizationSSR(
  publicId: string,
): Promise<OrganizationPublic | null> {
  const id = publicId.trim();
  if (!id) return null;
  const res = await fetch(`${apiBase()}/api/organizations/${encodeURIComponent(id)}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const row = (await res.json()) as Record<string, unknown>;
  const created = row.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();
  const mc = row.memberCount;
  const memberCount =
    typeof mc === "number" && Number.isFinite(mc) ? Math.max(1, Math.floor(mc)) : 1;
  return {
    publicId: String(row.publicId ?? ""),
    name: String(row.name ?? ""),
    isOwner: row.isOwner === true,
    createdAt,
    memberCount,
    workspacePermissions: parseWorkspacePermissions(row.workspacePermissions),
  };
}

/** Server-only: bucket listing at root prefix (no client Network tab on first paint). */
export async function fetchS3BucketObjectsSSR(
  profileId: string,
  prefix = "",
  organizationPublicId?: string | null,
): Promise<S3BucketListResponse | null> {
  const q = new URLSearchParams();
  if (prefix) q.set("prefix", prefix);
  const org = organizationPublicId?.trim();
  if (org) q.set("organizationPublicId", org);
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
  organizationPublicId?: string | null,
): Promise<S3PrefixSummaryResponse | null> {
  const q = new URLSearchParams({ prefix: folderPrefix });
  const org = organizationPublicId?.trim();
  if (org) q.set("organizationPublicId", org);
  const res = await fetch(
    `${apiBase()}/api/s3/profiles/${encodeURIComponent(profileId)}/prefix-summary?${q.toString()}`,
    { headers: await cookieHeaders(), cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as S3PrefixSummaryResponse;
}

