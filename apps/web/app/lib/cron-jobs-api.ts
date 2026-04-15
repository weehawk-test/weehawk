import { API_BASE } from "./api";
import type { DatabaseBackupConfig } from "./database-backup-preview";
import type { WebhookServiceAction, WebhookTargetMode } from "./webhooks-api";

export type { DatabaseBackupConfig };

export type CronJobListItem = {
  id: number;
  /** URL-safe id; prefer for routes and links. */
  publicId?: string;
  name: string;
  description: string;
  isActive: boolean;
  triggerType: "cron";
  cronExpression: string;
  targetMode: WebhookTargetMode;
  serviceId: number | null;
  remoteServerId: number | null;
  serviceAction: WebhookServiceAction | null;
  notifyOnTrigger: boolean;
  notifyMessage?: string | null;
  createdAt: string;
  summary: string;
};

export type CronJobDetail = CronJobListItem & {
  volumeSource: string | null;
  dockerCommand: string | null;
  databaseBackupConfig: DatabaseBackupConfig | null;
  databaseBackupPreview: string | null;
  backupS3ProfileName: string | null;
  notifyChannelId: string | null;
  notifyMessage: string | null;
};

export function cronJobRouteId(j: { publicId?: string | null; id: number }): string {
  const p = j.publicId?.trim();
  return p ? p : String(j.id);
}

export type CreateCronJobBody = {
  name: string;
  description?: string;
  cronExpression: string;
  targetMode: WebhookTargetMode;
  serviceId?: number;
  remoteServerId?: number;
  serviceAction?: WebhookServiceAction;
  volumeSource?: string;
  dockerCommand?: string;
  databaseBackupConfig?: DatabaseBackupConfig;
  backupS3ProfileName?: string;
  notifyChannelId?: string;
  notifyMessage?: string;
};

export type UpdateCronJobBody = {
  name?: string;
  description?: string;
  cronExpression?: string;
  isActive?: boolean;
  remoteServerId?: number | null;
  dockerCommand?: string | null;
  notifyChannelId?: string | null;
  notifyMessage?: string | null;
  backupS3ProfileName?: string | null;
  databaseBackupConfig?: DatabaseBackupConfig | null;
};

async function errorBody(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join(", ");
    if (typeof j.message === "string") return j.message;
  } catch {}
  return text || res.statusText;
}

function authHeaders(_accessToken: string): HeadersInit {
  return { Accept: "application/json" };
}

export async function fetchCronJobs(accessToken: string): Promise<CronJobListItem[]> {
  const res = await fetch(`${API_BASE}/api/cron-jobs`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobListItem, "triggerType">[];
  return data.map((j) => ({
    ...j,
    publicId:
      j.publicId == null || String(j.publicId).trim() === "" ? undefined : String(j.publicId),
    triggerType: "cron" as const,
  }));
}

export async function fetchCronJob(accessToken: string, id: string | number): Promise<CronJobDetail> {
  const res = await fetch(`${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    triggerType: "cron",
  };
}

export async function createCronJob(
  accessToken: string,
  body: CreateCronJobBody,
): Promise<CronJobDetail> {
  const res = await fetch(`${API_BASE}/api/cron-jobs`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    triggerType: "cron",
  };
}

export async function updateCronJob(
  accessToken: string,
  id: string | number,
  body: UpdateCronJobBody,
): Promise<CronJobDetail> {
  const res = await fetch(`${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    triggerType: "cron",
  };
}

export async function deleteCronJob(accessToken: string, id: string | number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
}
