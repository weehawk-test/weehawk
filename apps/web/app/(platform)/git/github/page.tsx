import { fetchGitSettingsSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { GitHubGitSettingsClient } from "./github-client";

export default async function GitHubGitSettingsPage() {
  const orgPid = (await getServerActiveOrganizationPublicId())?.trim() ?? "";
  const initialData = orgPid ? await fetchGitSettingsSSR(orgPid) : null;
  return <GitHubGitSettingsClient initialData={initialData} organizationPublicId={orgPid} />;
}
