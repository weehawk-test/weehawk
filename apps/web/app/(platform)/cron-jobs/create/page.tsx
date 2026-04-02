import { fetchNotificationChannelsSSR, fetchServicesSSR, fetchS3ProfilesSSR } from "@/lib/server-fetch";
import { CreateCronJobClient } from "./create-cron-job-client";

export default async function Page() {
  const [initialServices, initialChannels, initialS3Profiles] = await Promise.all([
    fetchServicesSSR(),
    fetchNotificationChannelsSSR(),
    fetchS3ProfilesSSR(),
  ]);
  return (
    <CreateCronJobClient
      initialServices={initialServices}
      initialChannels={initialChannels}
      initialS3Profiles={initialS3Profiles}
    />
  );
}
