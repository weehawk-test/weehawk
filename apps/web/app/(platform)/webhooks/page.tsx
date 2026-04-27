import { fetchWebhooksSSR } from "@/lib/server-fetch";
import { cookies } from "next/headers";
import {
  pendingDeletionCookieKey,
  readPendingDeletionsFromCookie,
} from "@/lib/pending-deletions";
import { WebhooksClient } from "./webhooks-client";

export default async function Page() {
  const cookieStore = await cookies();
  const pending = readPendingDeletionsFromCookie(
    "webhooks",
    cookieStore.get(pendingDeletionCookieKey("webhooks"))?.value,
  );
  const initialWebhooks = (await fetchWebhooksSSR()).filter((w) => {
    const id = String(w.id);
    const publicId = String(w.publicId ?? "").trim();
    return !pending.has(id) && (!publicId || !pending.has(publicId));
  });
  return <WebhooksClient initialWebhooks={initialWebhooks} />;
}
