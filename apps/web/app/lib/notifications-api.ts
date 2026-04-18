import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type NotificationChannel = {
  id: string;
  name: string;
  type: string;
  credentialPreview: string;
  targetPreview: string;
  isActive: boolean;
  /** Deploy host used for delivery (SSH + curl on this server). */
  remoteServerId: number | null;
  createdAt: string;
};

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

export async function fetchNotificationChannels(
  accessToken: string,
): Promise<NotificationChannel[]> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/channels`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function fetchNotificationChannelsPaged(
  accessToken: string,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedNotificationChannelsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const t = q.trim();
  if (t) params.set("q", t);
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

export async function bulkDeleteNotificationChannels(accessToken: string, ids: string[]): Promise<{ removed: number }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/channels/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
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
  id: string,
  body: Partial<{
    name: string;
    config: Record<string, unknown>;
    isActive: boolean;
    remoteServerId: number;
  }>,
): Promise<NotificationChannel> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/channels/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function deleteNotificationChannel(
  accessToken: string,
  id: string,
): Promise<void> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/channels/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorBody(res));
}

export async function testNotificationChannel(
  accessToken: string,
  channelId: string,
): Promise<{ success: boolean; message: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/channels/${channelId}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
