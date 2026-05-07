import { redirect } from "next/navigation";
import {
  fetchRemoteServersSSR,
  fetchNotificationChannelsSSR,
  fetchWebhookSSR,
} from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { EditWebhookClient } from "./edit-webhook-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditWebhookPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const orgPid = await getServerActiveOrganizationPublicId();
  const [webhook, initialChannels, initialRemoteServers] = await Promise.all([
    fetchWebhookSSR(id),
    fetchNotificationChannelsSSR(),
    fetchRemoteServersSSR(),
  ]);
  if (!webhook) redirect("/resource-not-found");
  if (webhook.publicId && id !== webhook.publicId) {
    redirect(`/webhooks/${webhook.publicId}/edit`);
  }
  return (
    <EditWebhookClient
      initialWebhook={webhook}
      initialChannels={initialChannels}
      initialRemoteServers={initialRemoteServers}
      activeOrgPublicId={orgPid ?? undefined}
    />
  );
}
