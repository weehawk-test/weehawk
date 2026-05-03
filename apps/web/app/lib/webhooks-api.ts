import { API_BASE } from "./api";

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
  serviceId: number | null;
  remoteServerId: number | null;
  notifyOnTrigger: boolean;
  notifyMessage?: string | null;
  createdAt: string;
  summary: string;
  secretToken: string;
  remoteTriggerUrl: string | null;
  hooksPublicHost: string | null;
  remoteTriggerUrlScheme: WebhookRemoteTriggerUrlScheme;
  triggerType: "webhook";
  cronExpression: null;
};

export type WebhookDetail = WebhookListItem & {
  bashScript: string | null;
  notifyChannelId: number | null;
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
  serviceId?: number | string;
  remoteServerId?: number;
  bashScript: string;
  notifyChannelId?: number;
  notifyMessage?: string;
  /** Traefik hostname; API runs docker build on the deploy host unless WEEHAWK_WEBHOOK_AGENT_IMAGE is set. */
  hooksPublicHost?: string;
  /** Trigger URLs always use https. */
  remoteTriggerUrlScheme?: WebhookRemoteTriggerUrlScheme;
  /** When true, omitted from the main /webhooks list (service auto webhooks). */
  hiddenFromWebhooksList?: boolean;
  organizationPublicId?: string;
};

export type UpdateWebhookBody = {
  name?: string;
  description?: string;
  remoteServerId?: number | null;
  bashScript?: string | null;
  notifyChannelId?: number | null;
  notifyMessage?: string | null;
  hooksPublicHost?: string | null;
  remoteTriggerUrlScheme?: WebhookRemoteTriggerUrlScheme;
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
  options?: { includeHidden?: boolean; organizationPublicId?: string | null },
): Promise<WebhookListItem[]> {
  const params = new URLSearchParams();
  if (options?.includeHidden === true) params.set("includeHidden", "true");
  const org = options?.organizationPublicId?.trim();
  if (org) params.set("organizationPublicId", org);
  const qs = params.toString() ? `?${params.toString()}` : "";
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

export async function fetchWebhook(
  accessToken: string,
  id: string | number,
  organizationPublicId?: string | null,
): Promise<WebhookDetail> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(String(id))}${q}`, {
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
  organizationPublicId?: string | null,
): Promise<WebhookDetail> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(String(id))}${q}`, {
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
    remoteTriggerUrl: data.remoteTriggerUrl ?? null,
    hooksPublicHost: data.hooksPublicHost ?? null,
    remoteTriggerUrlScheme: "https",
    triggerType: "webhook",
    cronExpression: null,
  };
}

export async function deleteWebhook(
  accessToken: string,
  id: string | number,
  organizationPublicId?: string | null,
): Promise<void> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/webhooks/${encodeURIComponent(String(id))}${q}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
}

export async function fetchWebhookLastRunLog(
  accessToken: string,
  id: string | number,
  lines = 200,
  organizationPublicId?: string | null,
): Promise<{ log: string; source: string }> {
  const params = new URLSearchParams({ lines: String(lines) });
  const org = organizationPublicId?.trim();
  if (org) params.set("organizationPublicId", org);
  const res = await fetch(
    `${API_BASE}/api/webhooks/${encodeURIComponent(String(id))}/last-log?${params.toString()}`,
    {
      headers: authHeaders(accessToken),
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as { log?: string | null; source?: string | null };
  return {
    log: typeof data.log === "string" ? data.log : "",
    source: typeof data.source === "string" ? data.source : "unknown",
  };
}
