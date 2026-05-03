import { fetchNotificationChannelsSSR, fetchRemoteServersSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { CreateWebhookClient } from "./create-webhook-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const orgPid = await getServerActiveOrganizationPublicId();
  const org = orgPid?.trim() ?? "";
  const [initialChannels, initialRemoteServers] = await Promise.all([
    fetchNotificationChannelsSSR(org || undefined),
    fetchRemoteServersSSR(org || undefined),
  ]);
  return (
    <CreateWebhookClient
      initialChannels={initialChannels}
      initialRemoteServers={initialRemoteServers}
      organizationPublicId={orgPid ?? undefined}
    />
  );
}
