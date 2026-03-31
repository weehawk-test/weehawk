import { notFound } from "next/navigation";
import { fetchCronJobSSR, fetchNotificationChannelsSSR } from "@/lib/server-fetch";
import { EditCronJobClient } from "./edit-cron-job-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCronJobPage({ params }: PageProps) {
  const { id } = await params;
  const [cronJob, initialChannels] = await Promise.all([fetchCronJobSSR(id), fetchNotificationChannelsSSR()]);
  if (!cronJob) notFound();
  return <EditCronJobClient id={id} initialCronJob={cronJob} initialChannels={initialChannels} />;
}
