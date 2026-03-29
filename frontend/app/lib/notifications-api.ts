import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type NotificationChannel = {
  id: string;
  name: string;
  type: string;
  botToken: string;
  chatId: string;
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

export async function createNotificationChannel(
  accessToken: string,
  body: { name: string; botToken: string; chatId: string },
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
  body: Partial<{ name: string; botToken: string; chatId: string; isActive: boolean }>,
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

