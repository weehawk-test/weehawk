import { fetchCronJobsSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { CronJobsClient } from "./cron-jobs-client";

export const dynamic = "force-dynamic";

export async function CronJobsPageInner({
  organizationPublicId,
}: {
  organizationPublicId?: string;
}) {
  const initialJobs = await fetchCronJobsSSR(organizationPublicId);
  return <CronJobsClient initialJobs={initialJobs} organizationPublicId={organizationPublicId} />;
}

export default async function Page() {
  const orgPid = await getServerActiveOrganizationPublicId();
  return CronJobsPageInner({ organizationPublicId: orgPid ?? undefined });
}
