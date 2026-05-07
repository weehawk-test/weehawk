import { redirect } from "next/navigation";
import {
  fetchCronJobSSR,
  fetchNotificationChannelsSSR,
  fetchRemoteServersSSR,
} from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { EditCronJobClient } from "./edit-cron-job-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCronJobPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const orgPid = await getServerActiveOrganizationPublicId();
  const [cronJob, initialChannels, initialRemoteServers] = await Promise.all([
    fetchCronJobSSR(id),
    fetchNotificationChannelsSSR(),
    fetchRemoteServersSSR(),
  ]);
  if (!cronJob) redirect("/resource-not-found");
  if (cronJob.publicId && id !== cronJob.publicId) {
    redirect(`/cron-jobs/${cronJob.publicId}/edit`);
  }
  return (
    <EditCronJobClient
      initialCronJob={cronJob}
      initialChannels={initialChannels}
      initialRemoteServers={initialRemoteServers}
      activeOrgPublicId={orgPid ?? undefined}
    />
  );
}
