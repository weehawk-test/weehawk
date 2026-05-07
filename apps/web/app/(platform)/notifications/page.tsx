import { fetchNotificationChannelsPagedSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { NotificationsChannelsClient } from "./channels/notifications-channels-client";
import type { PaginatedNotificationChannelsResponse } from "@/lib/notifications-api";

const CHANNELS_PAGE_SIZE = 10;

export const NOTIFICATIONS_BASE_PATH = "/notifications";

export const dynamic = "force-dynamic";

export async function NotificationsListView({
  searchParams,
  notificationsBasePath = NOTIFICATIONS_BASE_PATH,
  activeOrgPublicId,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
  /** e.g. `/organizations/:publicId/notifications` in org workspace */
  notificationsBasePath?: string;
  activeOrgPublicId?: string;
}) {
  const sp = await searchParams;
  const urlPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const urlQ = typeof sp.q === "string" ? sp.q : "";
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
  return (
    <NotificationsChannelsClient
      initialData={initialData}
      initialError={initialError}
      urlPage={urlPage}
      urlQ={urlQ}
      notificationsBasePath={notificationsBasePath}
      activeOrgPublicId={activeOrgPublicId}
    />
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const orgPid = await getServerActiveOrganizationPublicId();
  return NotificationsListView({
    searchParams,
    notificationsBasePath: NOTIFICATIONS_BASE_PATH,
    activeOrgPublicId: orgPid ?? undefined,
  });
}
