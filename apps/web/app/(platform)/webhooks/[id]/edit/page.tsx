import { notFound, redirect } from "next/navigation";
import {
  fetchRemoteServersSSR,
  fetchNotificationChannelsSSR,
  fetchS3ProfilesSSR,
  fetchServicesSSR,
  fetchWebhookSSR,
} from "@/lib/server-fetch";
import { EditWebhookClient } from "./edit-webhook-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditWebhookPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const [webhook, initialChannels, initialS3Profiles, initialServices, initialRemoteServers] = await Promise.all([
    fetchWebhookSSR(id),
    fetchNotificationChannelsSSR(),
    fetchS3ProfilesSSR(),
    fetchServicesSSR(),
    fetchRemoteServersSSR(),
  ]);
  if (!webhook) notFound();
  if (webhook.publicId && id !== webhook.publicId) {
    redirect(`/webhooks/${webhook.publicId}/edit`);
  }
  return (
    <EditWebhookClient
      initialWebhook={webhook}
      initialChannels={initialChannels}
      initialS3Profiles={initialS3Profiles}
      initialServices={initialServices}
      initialRemoteServers={initialRemoteServers}
    />
  );
}
