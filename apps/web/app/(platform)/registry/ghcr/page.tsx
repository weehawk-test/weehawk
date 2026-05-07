import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { RegistrySettingsClient } from "../_components/registry-settings-client";

export default async function RegistryGhcrPage() {
  const orgPid = (await getServerActiveOrganizationPublicId())?.trim() ?? "";
  return <RegistrySettingsClient preset="ghcr" activeOrgPublicId={orgPid} />;
}
