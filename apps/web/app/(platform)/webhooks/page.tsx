import { fetchWebhooksSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { WebhooksClient } from "./webhooks-client";

export const dynamic = "force-dynamic";

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
  const orgPid = await getServerActiveOrganizationPublicId();
  return WebhooksPageInner({ organizationPublicId: orgPid ?? undefined });
}
