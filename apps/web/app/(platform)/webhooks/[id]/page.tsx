import { notFound } from "next/navigation";
import { fetchWebhookSSR } from "@/lib/server-fetch";
import { WebhookDetailsClient } from "./webhook-details-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WebhookDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const webhook = await fetchWebhookSSR(id);
  if (!webhook) notFound();
  return <WebhookDetailsClient id={id} initialWebhook={webhook} />;
}
