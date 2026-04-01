import { fetchNotificationChannelsSSR, fetchServicesSSR } from "@/lib/server-fetch";
import { CreateWebhookClient } from "./create-webhook-client";

export default async function Page() {
  const [initialServices, initialChannels] = await Promise.all([
    fetchServicesSSR(),
    fetchNotificationChannelsSSR(),
  ]);
  return <CreateWebhookClient initialServices={initialServices} initialChannels={initialChannels} />;
}
