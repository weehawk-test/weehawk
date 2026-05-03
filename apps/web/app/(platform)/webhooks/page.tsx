import { fetchWebhooksSSR } from "@/lib/server-fetch";
import { WebhooksClient } from "./webhooks-client";

export async function WebhooksPageInner({
  organizationPublicId,
}: {
  organizationPublicId?: string;
}) {
  const initialWebhooks = await fetchWebhooksSSR(organizationPublicId);
  return (
    <WebhooksClient
      initialWebhooks={initialWebhooks}
      organizationPublicId={organizationPublicId}
    />
  );
}

export default async function Page() {
  return WebhooksPageInner({});
}
