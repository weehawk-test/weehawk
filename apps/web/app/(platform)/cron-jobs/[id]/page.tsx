import { notFound, redirect } from "next/navigation";
import { fetchCronJobSSR } from "@/lib/server-fetch";
import { CronJobDetailsClient } from "./cron-job-details-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CronJobDetailsPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const cronJob = await fetchCronJobSSR(id);
  if (!cronJob) notFound();
  if (cronJob.publicId && id !== cronJob.publicId) {
    redirect(`/cron-jobs/${cronJob.publicId}`);
  }
  return <CronJobDetailsClient initialCronJob={cronJob} />;
}
