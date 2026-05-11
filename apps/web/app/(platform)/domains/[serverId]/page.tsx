import { ServerDomainsPageClient } from "./server-domains-page-client";
import { fetchRemoteServersSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

export const dynamic = "force-dynamic";

export default async function PerServerDomainsPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const orgPid = await getServerActiveOrganizationPublicId();
  const initialRemoteServers = await fetchRemoteServersSSR();

  return (
    <ServerDomainsPageClient
      serverId={serverId}
      initialRemoteServers={initialRemoteServers}
      activeOrgPublicId={orgPid ?? null}
      initialRemoteServersOrganizationId={orgPid ?? null}
    />
  );
}
