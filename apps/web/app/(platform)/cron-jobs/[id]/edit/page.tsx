import { notFound, redirect } from "next/navigation";
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
  const { id: rawId } = await params;
  const id = rawId.trim();
  const [cronJob, initialChannels, initialS3Profiles, initialServices, initialRemoteServers] = await Promise.all([
    fetchCronJobSSR(id),
    fetchNotificationChannelsSSR(),
    fetchS3ProfilesSSR(),
    fetchServicesSSR(),
    fetchRemoteServersSSR(),
  ]);
  if (!cronJob) notFound();
  if (cronJob.publicId && id !== cronJob.publicId) {
    redirect(`/cron-jobs/${cronJob.publicId}/edit`);
  }
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
