import { DeployDomainsClient } from "./deploy-domains-client";
import { fetchRemoteServersSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const orgPid = await getServerActiveOrganizationPublicId();
  const initialRemoteServers = await fetchRemoteServersSSR();

  return (
    <DeployDomainsClient
      initialRemoteServers={initialRemoteServers}
      activeOrgPublicId={orgPid ?? null}
      initialRemoteServersOrganizationId={orgPid ?? null}
    />
  );
}
