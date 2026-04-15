import { RemoteServerSettingsClient } from "./remote-server-settings-client";
import { fetchRemoteServersSSR } from "@/lib/server-fetch";

export default async function RemoteServerPage() {
  const initialRemoteServers = await fetchRemoteServersSSR();
  return <RemoteServerSettingsClient initialRemoteServers={initialRemoteServers} />;
}
