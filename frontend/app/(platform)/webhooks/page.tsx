import { fetchWebhooksSSR } from "@/lib/server-fetch";
import { WebhooksClient } from "./webhooks-client";

export default async function Page() {
  const initialWebhooks = await fetchWebhooksSSR();
  return <WebhooksClient initialWebhooks={initialWebhooks} />;
}
