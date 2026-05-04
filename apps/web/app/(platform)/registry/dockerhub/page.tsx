import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { RegistrySettingsClient } from "../_components/registry-settings-client";

export default async function RegistryDockerHubPage() {
  const orgPid = (await getServerActiveOrganizationPublicId())?.trim() ?? "";
  return <RegistrySettingsClient preset="dockerhub" organizationPublicId={orgPid} />;
}
