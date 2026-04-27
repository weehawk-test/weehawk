import { fetchNotificationChannelsPagedSSR } from "@/lib/server-fetch";
import { NotificationsChannelsClient } from "./channels/notifications-channels-client";
import type { PaginatedNotificationChannelsResponse } from "@/lib/notifications-api";

const CHANNELS_PAGE_SIZE = 10;

export default async function NotificationsPage({
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
    initialData = await fetchNotificationChannelsPagedSSR(urlPage, CHANNELS_PAGE_SIZE, urlQ);
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
