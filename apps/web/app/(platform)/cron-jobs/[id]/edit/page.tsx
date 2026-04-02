import { notFound } from "next/navigation";
import {
  fetchCronJobSSR,
  fetchNotificationChannelsSSR,
  fetchS3ProfilesSSR,
  fetchServicesSSR,
} from "@/lib/server-fetch";
import { EditCronJobClient } from "./edit-cron-job-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCronJobPage({ params }: PageProps) {
  const { id } = await params;
  const [cronJob, initialChannels, initialS3Profiles, initialServices] = await Promise.all([
    fetchCronJobSSR(id),
    fetchNotificationChannelsSSR(),
    fetchS3ProfilesSSR(),
    fetchServicesSSR(),
  ]);
  if (!cronJob) notFound();
  return (
    <EditCronJobClient
      id={id}
      initialCronJob={cronJob}
      initialChannels={initialChannels}
      initialS3Profiles={initialS3Profiles}
      initialServices={initialServices}
    />
  );
}
