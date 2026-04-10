import { notFound } from "next/navigation";
import { fetchCronJobSSR } from "@/lib/server-fetch";
import { CronJobDetailsClient } from "./cron-job-details-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CronJobDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const cronJob = await fetchCronJobSSR(id);
  if (!cronJob) notFound();
  return <CronJobDetailsClient initialCronJob={cronJob} />;
}
