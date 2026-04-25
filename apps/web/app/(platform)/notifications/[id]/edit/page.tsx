import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { NotificationsChannelsClient } from "../../channels/notifications-channels-client";
import type {
  NotificationChannel,
  PaginatedNotificationChannelsResponse,
} from "@/lib/notifications-api";

const CHANNELS_PAGE_SIZE = 10;

async function getChannelsPaged(page: number, q: string): Promise<PaginatedNotificationChannelsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(CHANNELS_PAGE_SIZE),
  });
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_BASE}/api/notifications/channels/paged?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Could not load notification channels.");
  }
  return res.json();
}

async function getChannelsList(): Promise<NotificationChannel[]> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_BASE}/api/notifications/channels`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
    },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as NotificationChannel[];
}

export default async function NotificationsEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const urlPage = 1;
  const urlQ = "";
  let initialData: PaginatedNotificationChannelsResponse | null = null;
  let initialError: string | null = null;
  try {
    initialData = await getChannelsPaged(urlPage, urlQ);
  } catch (e) {
    initialError = e instanceof Error ? e.message : String(e);
  }
  const channels = await getChannelsList();
  const channel = channels.find((ch) => String(ch.publicId ?? "") === id || String(ch.id) === id) ?? null;
  if (!channel) redirect("/resource-not-found");

  return (
    <NotificationsChannelsClient
      initialData={initialData}
      initialError={initialError}
      urlPage={urlPage}
      urlQ={urlQ}
      initialMode="edit"
      initialRouteChannel={channel}
    />
  );
}
