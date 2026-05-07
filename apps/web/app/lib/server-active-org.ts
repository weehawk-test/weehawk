import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";
import {
  fetchActiveOrganizationSSR,
  fetchOrganizationSSR,
  fetchOrganizationsListSSR,
} from "@/lib/server-fetch";

/**
 * Active org for SSR: server-side active organization if it still resolves to a membership;
 * otherwise falls back to the same default as the workspace switcher.
 */
export async function getServerActiveOrganizationPublicId(): Promise<string | null> {
  const fromServer = (await fetchActiveOrganizationSSR())?.trim();
  if (fromServer) {
    const current = await fetchOrganizationSSR(fromServer);
    if (current) return fromServer;
  }
  const orgs = await fetchOrganizationsListSSR();
  const d = pickDefaultWorkspaceOrganization(orgs);
  return d?.publicId?.trim() || null;
}
