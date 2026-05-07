import { fetchWebhooksSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { WebhooksClient } from "./webhooks-client";

export const dynamic = "force-dynamic";

export async function WebhooksPageInner({
  activeOrgPublicId,
}: {
  activeOrgPublicId?: string;
}) {
  const initialWebhooks = await fetchWebhooksSSR();
  return (
    <WebhooksClient
      initialWebhooks={initialWebhooks}
      activeOrgPublicId={activeOrgPublicId}
    />
  );
}

export default async function Page() {
  const orgPid = await getServerActiveOrganizationPublicId();
  return WebhooksPageInner({ activeOrgPublicId: orgPid ?? undefined });
}
