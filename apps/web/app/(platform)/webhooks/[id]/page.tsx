import { redirect } from "next/navigation";
import { fetchWebhookSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { WebhookDetailsClient } from "./webhook-details-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WebhookDetailsPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const orgPid = await getServerActiveOrganizationPublicId();
  const webhook = await fetchWebhookSSR(id, orgPid);
  if (!webhook) redirect("/resource-not-found");
  if (webhook.publicId && id !== webhook.publicId) {
    redirect(`/webhooks/${webhook.publicId}`);
  }
  return (
    <WebhookDetailsClient initialWebhook={webhook} organizationPublicId={orgPid ?? undefined} />
  );
}
