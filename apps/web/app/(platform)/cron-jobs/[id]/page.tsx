import { redirect } from "next/navigation";
import { fetchCronJobSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { CronJobDetailsClient } from "./cron-job-details-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CronJobDetailsPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const orgPid = await getServerActiveOrganizationPublicId();
  const cronJob = await fetchCronJobSSR(id, orgPid);
  if (!cronJob) redirect("/resource-not-found");
  if (cronJob.publicId && id !== cronJob.publicId) {
    redirect(`/cron-jobs/${cronJob.publicId}`);
  }
  return (
    <CronJobDetailsClient initialCronJob={cronJob} organizationPublicId={orgPid ?? undefined} />
  );
}
