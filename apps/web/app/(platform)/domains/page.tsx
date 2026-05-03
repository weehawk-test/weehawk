import { DeployDomainsClient } from "./deploy-domains-client";
import { fetchRemoteServersSSR, fetchTraefikSettingsSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const orgPid = await getServerActiveOrganizationPublicId();
  const orgPub = orgPid?.trim() ?? "";
  const [initialRemoteServers, initialTraefikSettings] = await Promise.all([
    fetchRemoteServersSSR(orgPid ?? undefined),
    orgPub ? fetchTraefikSettingsSSR(orgPub) : Promise.resolve(null),
  ]);

  return (
    <DeployDomainsClient
      initialRemoteServers={initialRemoteServers}
      initialTraefikSettings={initialTraefikSettings}
      organizationPublicId={orgPid ?? null}
      initialRemoteServersOrganizationId={orgPid ?? null}
      initialTraefikOrganizationId={orgPid ?? null}
    />
  );
}
