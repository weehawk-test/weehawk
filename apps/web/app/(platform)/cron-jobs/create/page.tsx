import { fetchNotificationChannelsSSR, fetchServicesSSR } from "@/lib/server-fetch";
import { CreateCronJobClient } from "./create-cron-job-client";

export default async function Page() {
  const [initialServices, initialChannels] = await Promise.all([
    fetchServicesSSR(),
    fetchNotificationChannelsSSR(),
  ]);
  return <CreateCronJobClient initialServices={initialServices} initialChannels={initialChannels} />;
}
