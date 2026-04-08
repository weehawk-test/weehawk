import {
  fetchNotificationChannelsSSR,
  fetchRemoteServersSSR,
  fetchServicesSSR,
  fetchS3ProfilesSSR,
} from "@/lib/server-fetch";
import { CreateCronJobClient } from "./create-cron-job-client";

export default async function Page() {
  const [initialServices, initialChannels, initialS3Profiles, initialRemoteServers] = await Promise.all([
    fetchServicesSSR(),
    fetchNotificationChannelsSSR(),
    fetchS3ProfilesSSR(),
    fetchRemoteServersSSR(),
  ]);
  return (
    <CreateCronJobClient
      initialServices={initialServices}
      initialChannels={initialChannels}
      initialS3Profiles={initialS3Profiles}
      initialRemoteServers={initialRemoteServers}
    />
  );
}
