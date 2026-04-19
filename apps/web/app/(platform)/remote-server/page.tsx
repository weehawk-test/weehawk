import { RemoteServerSettingsClient } from "./remote-server-settings-client";
import { fetchRemoteServersSSR, fetchTraefikSettingsSSR } from "@/lib/server-fetch";

export default async function RemoteServerPage() {
  const [initialRemoteServers, initialTraefikSettings] = await Promise.all([
    fetchRemoteServersSSR(),
    fetchTraefikSettingsSSR(),
  ]);
  return (
    <RemoteServerSettingsClient
      initialRemoteServers={initialRemoteServers}
      initialTraefikSettings={initialTraefikSettings}
    />
  );
}
