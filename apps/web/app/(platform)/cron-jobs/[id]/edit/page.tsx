import { notFound } from "next/navigation";
import {
  fetchCronJobSSR,
  fetchNotificationChannelsSSR,
  fetchRemoteServersSSR,
  fetchS3ProfilesSSR,
  fetchServicesSSR,
} from "@/lib/server-fetch";
import { EditCronJobClient } from "./edit-cron-job-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCronJobPage({ params }: PageProps) {
  const { id } = await params;
  const [cronJob, initialChannels, initialS3Profiles, initialServices, initialRemoteServers] = await Promise.all([
    fetchCronJobSSR(id),
    fetchNotificationChannelsSSR(),
    fetchS3ProfilesSSR(),
    fetchServicesSSR(),
    fetchRemoteServersSSR(),
  ]);
  if (!cronJob) notFound();
  return (
    <EditCronJobClient
      initialCronJob={cronJob}
      initialChannels={initialChannels}
      initialS3Profiles={initialS3Profiles}
      initialServices={initialServices}
      initialRemoteServers={initialRemoteServers}
    />
  );
}
