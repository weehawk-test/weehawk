import { fetchNotificationChannelsSSR, fetchRemoteServersSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { CreateCronJobClient } from "./create-cron-job-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const orgPid = await getServerActiveOrganizationPublicId();
  const org = orgPid?.trim() ?? "";
  const [initialChannels, initialRemoteServers] = await Promise.all([
    fetchNotificationChannelsSSR(org || undefined),
    fetchRemoteServersSSR(org || undefined),
  ]);
  return (
    <CreateCronJobClient
      initialChannels={initialChannels}
      initialRemoteServers={initialRemoteServers}
      organizationPublicId={orgPid ?? undefined}
    />
  );
}
