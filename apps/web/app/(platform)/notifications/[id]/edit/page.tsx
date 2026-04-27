import { redirect } from "next/navigation";
import {
  fetchNotificationChannelsPagedSSR,
  fetchNotificationChannelsSSR,
} from "@/lib/server-fetch";
import { NotificationsChannelsClient } from "../../channels/notifications-channels-client";
import type {
  NotificationChannel,
  PaginatedNotificationChannelsResponse,
} from "@/lib/notifications-api";

const CHANNELS_PAGE_SIZE = 10;

async function getChannelsList(): Promise<NotificationChannel[]> {
  return fetchNotificationChannelsSSR();
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
    initialData = await fetchNotificationChannelsPagedSSR(urlPage, CHANNELS_PAGE_SIZE, urlQ);
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
