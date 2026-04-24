import { fetchNotificationChannelsSSR, fetchRemoteServersSSR } from "@/lib/server-fetch";
import { CreateWebhookClient } from "./create-webhook-client";

export default async function Page() {
  const [initialChannels, initialRemoteServers] = await Promise.all([
    fetchNotificationChannelsSSR(),
    fetchRemoteServersSSR(),
  ]);
  return (
    <CreateWebhookClient initialChannels={initialChannels} initialRemoteServers={initialRemoteServers} />
  );
}
