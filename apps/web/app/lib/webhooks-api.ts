import { API_BASE } from "./api";
import type { DatabaseBackupConfig } from "./database-backup-preview";

export type { DatabaseBackupConfig };

export type WebhookTargetMode = "service";
export type WebhookServiceAction =
  | "redeploy"
  | "volume_backup"
  | "database_backup"
  | "docker_command"
  | "no_action";

export type WebhookListItem = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  triggerType: "webhook";
  cronExpression: null;
  targetMode: WebhookTargetMode;
  serviceId: number | null;
  remoteServerId: number | null;
  serviceAction: WebhookServiceAction | null;
  notifyOnTrigger: boolean;
  notifyMessage?: string | null;
  createdAt: string;
  summary: string;
  secretToken: string;
};

export type WebhookDetail = WebhookListItem & {
  volumeSource: string | null;
  dockerCommand: string | null;
  databaseBackupConfig: DatabaseBackupConfig | null;
  databaseBackupPreview: string | null;
  backupS3ProfileName: string | null;
  notifyChannelId: string | null;
  notifyMessage: string | null;
  secretToken: string;
};

export type CreateWebhookBody = {
  name: string;
  description?: string;
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

export type UpdateWebhookBody = {
  name?: string;
  description?: string;
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
  } catch {
    /* ignore */
  }
  return text || res.statusText;
}

function authHeaders(_accessToken: string): HeadersInit {
  return {
    Accept: "application/json",
  };
}

export function publicWebhookTriggerUrl(secretToken: string): string {
  return `${API_BASE}/hooks/${secretToken}`;
}

export async function fetchWebhooks(accessToken: string): Promise<WebhookListItem[]> {
  const res = await fetch(`${API_BASE}/api/webhooks`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<WebhookListItem, "triggerType" | "cronExpression">[];
  return data.map((w) => ({ ...w, triggerType: "webhook", cronExpression: null }));
}

export async function fetchWebhook(accessToken: string, id: string): Promise<WebhookDetail> {
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(id)}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<WebhookDetail, "triggerType" | "cronExpression">;
  return {
    ...data,
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    triggerType: "webhook",
    cronExpression: null,
  };
}

export async function createWebhook(
  accessToken: string,
  body: CreateWebhookBody,
): Promise<WebhookDetail> {
  const res = await fetch(`${API_BASE}/api/webhooks`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<WebhookDetail, "triggerType" | "cronExpression">;
  return {
    ...data,
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    triggerType: "webhook",
    cronExpression: null,
  };
}

export async function updateWebhook(
  accessToken: string,
  id: string,
  body: UpdateWebhookBody,
): Promise<WebhookDetail> {
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<WebhookDetail, "triggerType" | "cronExpression">;
  return {
    ...data,
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    triggerType: "webhook",
    cronExpression: null,
  };
}

export async function deleteWebhook(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
}
