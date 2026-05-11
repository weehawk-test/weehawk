import { RemoteServerSettingsClient } from "../remote-server-settings-client";
import { fetchRemoteServersSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";

export const dynamic = "force-dynamic";

export default async function RemoteServerAddThisMachinePage() {
  const orgPid = await getServerActiveOrganizationPublicId();
  const initialRemoteServers = await fetchRemoteServersSSR();
  return (
    <RemoteServerSettingsClient
      pageVariant="add-this-machine"
      initialRemoteServers={initialRemoteServers}
      activeOrgPublicId={orgPid ?? null}
      initialRemoteServersOrganizationId={orgPid ?? null}
    />
  );
}
