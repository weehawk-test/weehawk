import { cookies } from "next/headers";
import { WEHAWK_ACTIVE_ORG_COOKIE } from "@/lib/active-org-cookie";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";
import {
  fetchOrganizationSSR,
  fetchOrganizationsListSSR,
} from "@/lib/server-fetch";

/**
 * Active org for SSR: cookie if it still resolves to a membership; otherwise same default as the workspace switcher.
 * Ignores a stale cookie (e.g. after leaving an org) so the user is not forced to `/organizations/create` while they still belong to another org.
 */
export async function getServerActiveOrganizationPublicId(): Promise<string | null> {
  const jar = await cookies();
  const fromCookie = jar.get(WEHAWK_ACTIVE_ORG_COOKIE)?.value?.trim();
  if (fromCookie) {
    const current = await fetchOrganizationSSR(fromCookie);
    if (current) return fromCookie;
  }
  const orgs = await fetchOrganizationsListSSR();
  const d = pickDefaultWorkspaceOrganization(orgs);
  return d?.publicId?.trim() || null;
}
