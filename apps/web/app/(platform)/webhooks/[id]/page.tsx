import { redirect } from "next/navigation";
import { fetchWebhookSSR } from "@/lib/server-fetch";
import { WebhookDetailsClient } from "./webhook-details-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WebhookDetailsPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const webhook = await fetchWebhookSSR(id);
  if (!webhook) redirect("/resource-not-found");
  if (webhook.publicId && id !== webhook.publicId) {
    redirect(`/webhooks/${webhook.publicId}`);
  }
  return <WebhookDetailsClient initialWebhook={webhook} />;
}
