import { fetchGitSettingsSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { GitLabGitSettingsClient } from "./gitlab-client";

export default async function GitLabGitSettingsPage() {
  const orgPid = (await getServerActiveOrganizationPublicId())?.trim() ?? "";
  const initialData = orgPid ? await fetchGitSettingsSSR(orgPid) : null;
  return <GitLabGitSettingsClient initialData={initialData} organizationPublicId={orgPid} />;
}
