import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type NotificationChannel = {
  id: number;
  /** Public id (e.g. `nch_…`) when present; use with API paths that accept public id. */
  publicId?: string;
  name: string;
  type: string;
  credentialPreview: string;
  targetPreview: string;
  /** Deploy host used for delivery (SSH + curl on this server). */
  remoteServerId: number | null;
  createdAt: string;
};

export function notificationChannelRouteId(ch: { publicId?: string | null; id: number }): string {
  const p = ch.publicId?.trim();
  return p ? p : String(ch.id);
}

export type PaginatedNotificationChannelsResponse = {
  items: NotificationChannel[];
  total: number;
  page: number;
  pageSize: number;
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

function orgQuery(organizationPublicId?: string | null): string {
  const o = organizationPublicId?.trim();
  if (!o) throw new Error("organizationPublicId is required");
  return `?organizationPublicId=${encodeURIComponent(o)}`;
}

export async function fetchNotificationChannels(
  accessToken: string,
  organizationPublicId: string | null | undefined,
): Promise<NotificationChannel[]> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/notifications/channels${orgQuery(organizationPublicId)}`,
    {
      method: "GET",
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function fetchNotificationChannelsPaged(
  accessToken: string,
  page: number,
  pageSize: number,
  q: string,
  organizationPublicId: string | null | undefined,
): Promise<PaginatedNotificationChannelsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const t = q.trim();
  if (t) params.set("q", t);
  const org = organizationPublicId?.trim();
  if (!org) throw new Error("organizationPublicId is required");
  params.set("organizationPublicId", org);
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/notifications/channels/paged?${params.toString()}`,
    {
      method: "GET",
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function bulkDeleteNotificationChannels(
  accessToken: string,
  ids: string[],
  organizationPublicId: string | null | undefined,
): Promise<{ removed: number }> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/notifications/channels/bulk-delete${orgQuery(organizationPublicId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function createNotificationChannel(
  accessToken: string,
  body: {
    name: string;
    type: string;
    config: Record<string, unknown>;
    /** When omitted, channel is saved without a deploy host until you edit or PATCH. */
    remoteServerId?: number;
    organizationPublicId: string;
  },
): Promise<NotificationChannel> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function updateNotificationChannel(
  accessToken: string,
  id: number | string,
  body: Partial<{
    name: string;
    config: Record<string, unknown>;
    remoteServerId: number;
  }>,
  organizationPublicId: string | null | undefined,
): Promise<NotificationChannel> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/notifications/channels/${id}${orgQuery(organizationPublicId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function deleteNotificationChannel(
  accessToken: string,
  id: number | string,
  organizationPublicId: string | null | undefined,
): Promise<void> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/notifications/channels/${id}${orgQuery(organizationPublicId)}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
}

export async function testNotificationChannel(
  accessToken: string,
  channelId: number | string,
  organizationPublicId: string | null | undefined,
): Promise<{ success: boolean; message: string }> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/notifications/channels/${channelId}/test${orgQuery(organizationPublicId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
