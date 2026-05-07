import { redirect } from "next/navigation";
import {
  fetchNotificationChannelsPagedSSR,
  fetchNotificationChannelsSSR,
} from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { NotificationsChannelsClient } from "../../channels/notifications-channels-client";
import type {
  NotificationChannel,
  PaginatedNotificationChannelsResponse,
} from "@/lib/notifications-api";
import { NOTIFICATIONS_BASE_PATH } from "../../page";

const CHANNELS_PAGE_SIZE = 10;

export const dynamic = "force-dynamic";

export async function NotificationsEditView({
  params,
  notificationsBasePath = NOTIFICATIONS_BASE_PATH,
  activeOrgPublicId,
}: {
  params: Promise<{ id: string }>;
  notificationsBasePath?: string;
  activeOrgPublicId?: string | null;
}) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const urlPage = 1;
  const urlQ = "";
  let initialData: PaginatedNotificationChannelsResponse | null = null;
  let initialError: string | null = null;
  try {
    initialData = await fetchNotificationChannelsPagedSSR(
      urlPage,
      CHANNELS_PAGE_SIZE,
      urlQ,
    );
  } catch (e) {
    initialError = e instanceof Error ? e.message : String(e);
  }
  const channels = await fetchNotificationChannelsSSR();
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
      notificationsBasePath={notificationsBasePath}
      activeOrgPublicId={activeOrgPublicId ?? undefined}
    />
  );
}

export default async function NotificationsEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const orgPid = await getServerActiveOrganizationPublicId();
  return NotificationsEditView({
    params,
    notificationsBasePath: NOTIFICATIONS_BASE_PATH,
    activeOrgPublicId: orgPid ?? undefined,
  });
}
