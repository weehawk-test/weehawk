import { fetchNotificationChannelsSSR, fetchRemoteServersSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { CreateWebhookClient } from "./create-webhook-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const orgPid = await getServerActiveOrganizationPublicId();
  const [initialChannels, initialRemoteServers] = await Promise.all([
    fetchNotificationChannelsSSR(),
    fetchRemoteServersSSR(),
  ]);
  return (
    <CreateWebhookClient
      initialChannels={initialChannels}
      initialRemoteServers={initialRemoteServers}
      activeOrgPublicId={orgPid ?? undefined}
    />
  );
}
