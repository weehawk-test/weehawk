import { fetchCronJobsSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { CronJobsClient } from "./cron-jobs-client";

export const dynamic = "force-dynamic";

export async function CronJobsPageInner({
  activeOrgPublicId,
}: {
  activeOrgPublicId?: string;
}) {
  const initialJobs = await fetchCronJobsSSR();
  return <CronJobsClient initialJobs={initialJobs} activeOrgPublicId={activeOrgPublicId} />;
}

export default async function Page() {
  const orgPid = await getServerActiveOrganizationPublicId();
  return CronJobsPageInner({ activeOrgPublicId: orgPid ?? undefined });
}
