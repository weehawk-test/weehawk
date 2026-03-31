import { headers } from "next/headers";
import type { WebhookDetail, WebhookListItem } from "./webhooks-api";
import type { CronJobDetail, CronJobListItem } from "./cron-jobs-api";
import type { Project, Service } from "./schema";
import type { NotificationChannel } from "./notifications-api";
import { mapApiServiceToService } from "./services-api";
import { mapApiProjectToProject } from "./projects-api";
import { getServerApiBase } from "./server-api";

async function cookieHeaders(): Promise<HeadersInit> {
  const h = await headers();
  const cookie = h.get("cookie");
  return {
    Accept: "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
  };
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
  return { ...data, triggerType: "webhook", cronExpression: null };
}

export async function fetchWebhooksSSR(): Promise<WebhookListItem[]> {
  const res = await fetch(`${apiBase()}/api/webhooks`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Omit<WebhookListItem, "triggerType" | "cronExpression">[];
  return data.map((w) => ({ ...w, triggerType: "webhook" as const, cronExpression: null }));
}

export async function fetchCronJobSSR(id: string): Promise<CronJobDetail | null> {
  const res = await fetch(`${apiBase()}/api/cron-jobs/${encodeURIComponent(id)}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return { ...data, triggerType: "cron" };
}

export async function fetchCronJobsSSR(): Promise<CronJobListItem[]> {
  const res = await fetch(`${apiBase()}/api/cron-jobs`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Omit<CronJobListItem, "triggerType">[];
  return data.map((j) => ({ ...j, triggerType: "cron" as const }));
}

export async function fetchProjectSSR(id: string): Promise<Project | null> {
  const res = await fetch(`${apiBase()}/projects/${encodeURIComponent(id)}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return mapApiProjectToProject(await res.json());
}

export async function fetchProjectsSSR(): Promise<Project[]> {
  const res = await fetch(`${apiBase()}/projects`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => mapApiProjectToProject(row))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function fetchServicesSSR(projectId?: string): Promise<Service[]> {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`${apiBase()}/services${q}`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => mapApiServiceToService(row));
}

export async function fetchNotificationChannelsSSR(): Promise<NotificationChannel[]> {
  const res = await fetch(`${apiBase()}/api/notifications/channels`, {
    headers: await cookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json() as Promise<NotificationChannel[]>;
}

