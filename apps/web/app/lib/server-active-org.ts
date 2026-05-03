import { cookies } from "next/headers";
import { WEHAWK_ACTIVE_ORG_COOKIE } from "@/lib/active-org-cookie";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";
import { fetchOrganizationsListSSR } from "@/lib/server-fetch";

/**
 * Active org for SSR: cookie first, then first membership from the API (same as workspace switcher default).
 */
export async function getServerActiveOrganizationPublicId(): Promise<string | null> {
  const jar = await cookies();
  const fromCookie = jar.get(WEHAWK_ACTIVE_ORG_COOKIE)?.value?.trim();
  if (fromCookie) return fromCookie;
  const orgs = await fetchOrganizationsListSSR();
  const d = pickDefaultWorkspaceOrganization(orgs);
  return d?.publicId?.trim() || null;
}
