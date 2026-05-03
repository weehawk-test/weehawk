import { fetchCronJobsSSR } from "@/lib/server-fetch";
import { CronJobsClient } from "./cron-jobs-client";

export async function CronJobsPageInner({
  organizationPublicId,
}: {
  organizationPublicId?: string;
}) {
  const initialJobs = await fetchCronJobsSSR(organizationPublicId);
  return (
    <CronJobsClient initialJobs={initialJobs} organizationPublicId={organizationPublicId} />
  );
}

export default async function Page() {
  return CronJobsPageInner({});
}
