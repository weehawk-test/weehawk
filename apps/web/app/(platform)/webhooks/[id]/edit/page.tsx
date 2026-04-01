import { notFound } from "next/navigation";
import { fetchNotificationChannelsSSR, fetchWebhookSSR } from "@/lib/server-fetch";
import { EditWebhookClient } from "./edit-webhook-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditWebhookPage({ params }: PageProps) {
  const { id } = await params;
  const [webhook, initialChannels] = await Promise.all([fetchWebhookSSR(id), fetchNotificationChannelsSSR()]);
  if (!webhook) notFound();
  return <EditWebhookClient id={id} initialWebhook={webhook} initialChannels={initialChannels} />;
}
