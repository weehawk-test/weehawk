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

export type WebhookRemoteTriggerUrlScheme = "https";

/** Must match apps/api/src/webhooks/hooks-public-host.ts */
const WEEHAWK_HOOK_PUBLIC_HOST_PREFIX = "";

/** Display value equals stored host (no forced subdomain). */
export function hooksPublicHostForDisplay(stored: string | null | undefined): string {
  if (stored == null || !String(stored).trim()) return "";
  const t = String(stored).trim().toLowerCase();
  return t;
}

export type WebhookListItem = {
  id: number;
  /** URL-safe id; prefer for routes and links. */
  publicId?: string;
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
  remoteTriggerUrl: string | null;
  hooksPublicHost: string | null;
  remoteTriggerUrlScheme: WebhookRemoteTriggerUrlScheme;
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
  /** On-host agent URL when the script is deployed to a remote server (same path token as API `/weehawk-hooks/{token}` by default). */
  remoteTriggerUrl: string | null;
};

/** Prefer `publicId` in URLs when the API has backfilled it. */
export function webhookRouteId(w: { publicId?: string | null; id: number }): string {
  const p = w.publicId?.trim();
  return p ? p : String(w.id);
}

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
  /** Traefik hostname; API runs docker build on the deploy host unless WEEHAWK_WEBHOOK_AGENT_IMAGE is set. */
  hooksPublicHost?: string;
  /** Trigger URLs always use https. */
  remoteTriggerUrlScheme?: WebhookRemoteTriggerUrlScheme;
  /** When true, omitted from the main /webhooks list (service auto webhooks). */
  hiddenFromWebhooksList?: boolean;
  /**
   * Weehawk API origin only (from NEXT_PUBLIC_API_URL). Primary trigger URL becomes POST {origin}/weehawk-hooks/{token}
   * (full UI redeploy). Omit to use the deploy-host agent URL.
   */
  hooksTriggerOrigin?: string;
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
  hooksPublicHost?: string | null;
  remoteTriggerUrlScheme?: WebhookRemoteTriggerUrlScheme;
  /** API origin from the browser ({@link API_BASE}); stored for remote-script callback env, not the displayed trigger URL. */
  hooksTriggerOrigin?: string | null;
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
  return `${API_BASE}/weehawk-hooks/${secretToken}`;
}

export async function fetchWebhooks(
  accessToken: string,
  options?: { includeHidden?: boolean },
): Promise<WebhookListItem[]> {
  const qs =
    options?.includeHidden === true
      ? `?${new URLSearchParams({ includeHidden: "true" }).toString()}`
      : "";
  const res = await fetch(`${API_BASE}/api/webhooks${qs}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
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

export async function fetchWebhook(accessToken: string, id: string | number): Promise<WebhookDetail> {
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(String(id))}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<WebhookDetail, "triggerType" | "cronExpression">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    remoteTriggerUrl: data.remoteTriggerUrl ?? null,
    hooksPublicHost: data.hooksPublicHost ?? null,
    remoteTriggerUrlScheme: "https",
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
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    remoteTriggerUrl: data.remoteTriggerUrl ?? null,
    hooksPublicHost: data.hooksPublicHost ?? null,
    remoteTriggerUrlScheme: "https",
    triggerType: "webhook",
    cronExpression: null,
  };
}

export async function updateWebhook(
  accessToken: string,
  id: string | number,
  body: UpdateWebhookBody,
): Promise<WebhookDetail> {
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(String(id))}`, {
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
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    databaseBackupConfig: data.databaseBackupConfig ?? null,
    databaseBackupPreview: data.databaseBackupPreview ?? null,
    remoteTriggerUrl: data.remoteTriggerUrl ?? null,
    hooksPublicHost: data.hooksPublicHost ?? null,
    remoteTriggerUrlScheme: "https",
    triggerType: "webhook",
    cronExpression: null,
  };
}

export async function deleteWebhook(accessToken: string, id: string | number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
}
