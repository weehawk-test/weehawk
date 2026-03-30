import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type NotificationChannel = {
  id: string;
  name: string;
  type: string;
  credentialPreview: string;
  targetPreview: string;
  isActive: boolean;
  createdAt: string;
};

export type NotificationLog = {
  id: string;
  channelId: string | null;
  channelName: string;
  message: string;
  status: "sent" | "failed";
  sentAt: string;
};

export type PaginatedNotificationLogsResponse = {
  items: NotificationLog[];
  total: number;
  page: number;
  pageSize: number;
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
  body: { name: string; type: string; config: Record<string, unknown> },
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
  body: Partial<{ name: string; config: Record<string, unknown>; isActive: boolean }>,
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

/** Test Telegram with bot token + chat ID before saving a channel. */
export async function testTelegramCredentials(
  accessToken: string,
  body: { botToken: string; chatId: string; channelName?: string },
): Promise<NotificationLog> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/test-credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function testNotificationChannel(
  accessToken: string,
  channelId: string,
): Promise<NotificationLog> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/channels/${channelId}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function fetchNotificationLogs(accessToken: string): Promise<NotificationLog[]> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/logs`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function fetchNotificationLogsPaged(
  accessToken: string,
  page: number,
  pageSize: number,
  q: string,
): Promise<PaginatedNotificationLogsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const t = q.trim();
  if (t) params.set("q", t);
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/logs/paged?${params.toString()}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function deleteNotificationLog(accessToken: string, id: string): Promise<void> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/logs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorBody(res));
}

export async function bulkDeleteNotificationLogs(accessToken: string, ids: string[]): Promise<{ removed: number }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/logs/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function sendNotification(
  accessToken: string,
  body: { channelId: string; message: string },
): Promise<NotificationLog> {
  const res = await authFetch(accessToken, `${API_BASE}/api/notifications/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

