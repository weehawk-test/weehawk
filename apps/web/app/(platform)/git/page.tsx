import { fetchGitSettingsSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { GitPageClient } from "./git-page-client";

export default async function GitLandingPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const orgPid = (await getServerActiveOrganizationPublicId())?.trim() ?? "";
  const settings = orgPid ? await fetchGitSettingsSSR() : null;
  const sp = await searchParams;
  return <GitPageClient initialSettings={settings} activeOrgPublicId={orgPid} initialQuery={sp?.q ?? ""} />;
}
