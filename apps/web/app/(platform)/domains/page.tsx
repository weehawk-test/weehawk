import { DeployDomainsClient } from "./deploy-domains-client";
import { fetchRemoteServersSSR, fetchTraefikSettingsSSR } from "@/lib/server-fetch";

export default async function DomainsPage() {
  const [initialRemoteServers, initialTraefikSettings] = await Promise.all([
    fetchRemoteServersSSR(),
    fetchTraefikSettingsSSR(),
  ]);

  return (
    <DeployDomainsClient
      initialRemoteServers={initialRemoteServers}
      initialTraefikSettings={initialTraefikSettings}
    />
  );
}
