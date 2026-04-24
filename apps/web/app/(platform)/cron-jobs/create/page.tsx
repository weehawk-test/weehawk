import { fetchNotificationChannelsSSR, fetchRemoteServersSSR } from "@/lib/server-fetch";
import { CreateCronJobClient } from "./create-cron-job-client";

export default async function Page() {
  const [initialChannels, initialRemoteServers] = await Promise.all([
    fetchNotificationChannelsSSR(),
    fetchRemoteServersSSR(),
  ]);
  return <CreateCronJobClient initialChannels={initialChannels} initialRemoteServers={initialRemoteServers} />;
}
