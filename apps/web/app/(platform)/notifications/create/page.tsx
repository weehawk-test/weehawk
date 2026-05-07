import { NotificationsChannelsClient } from "../channels/notifications-channels-client";
import type { PaginatedNotificationChannelsResponse } from "@/lib/notifications-api";
import { NOTIFICATIONS_BASE_PATH } from "../page";
import { fetchNotificationChannelsPagedSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

const CHANNELS_PAGE_SIZE = 10;

export const dynamic = "force-dynamic";

export async function NotificationsCreateView({
  notificationsBasePath = NOTIFICATIONS_BASE_PATH,
  activeOrgPublicId,
}: {
  notificationsBasePath?: string;
  activeOrgPublicId?: string | null;
}) {
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
  return (
    <NotificationsChannelsClient
      initialData={initialData}
      initialError={initialError}
      urlPage={urlPage}
      urlQ={urlQ}
      initialMode="create"
      notificationsBasePath={notificationsBasePath}
      activeOrgPublicId={activeOrgPublicId ?? undefined}
    />
  );
}

export default async function NotificationsCreatePage() {
  const orgPid = await getServerActiveOrganizationPublicId();
  return NotificationsCreateView({
    activeOrgPublicId: orgPid ?? undefined,
  });
}
