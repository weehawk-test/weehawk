import { redirect } from "next/navigation";
import {
  fetchRemoteServersSSR,
  fetchNotificationChannelsSSR,
  fetchWebhookSSR,
} from "@/lib/server-fetch";
import { EditWebhookClient } from "./edit-webhook-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditWebhookPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
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
    />
  );
}
