import { headers } from "next/headers";
import { API_BASE } from "@/lib/api";
import { NotificationsChannelsClient } from "./notifications-channels-client";
import type { PaginatedNotificationChannelsResponse } from "@/lib/notifications-api";

const CHANNELS_PAGE_SIZE = 10;

async function getChannelsPaged(
  page: number,
  q: string,
): Promise<PaginatedNotificationChannelsResponse> {
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

export default async function NotificationsChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const urlPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const urlQ = typeof sp.q === "string" ? sp.q : "";
  let initialData: PaginatedNotificationChannelsResponse | null = null;
  let initialError: string | null = null;
  try {
    initialData = await getChannelsPaged(urlPage, urlQ);
  } catch (e) {
    initialError = e instanceof Error ? e.message : String(e);
  }
  return (
    <NotificationsChannelsClient
      initialData={initialData}
      initialError={initialError}
      urlPage={urlPage}
      urlQ={urlQ}
    />
  );
}

