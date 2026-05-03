import { fetchCronJobsSSR } from "@/lib/server-fetch";
import { CronJobsClient } from "./cron-jobs-client";

export default async function Page() {
  const initialJobs = await fetchCronJobsSSR();
  return <CronJobsClient initialJobs={initialJobs} />;
}
