import { fetchGitSettingsSSR } from "@/lib/server-fetch";
import { GitHubGitSettingsClient } from "./github-client";

export default async function GitHubGitSettingsPage() {
  const initialData = await fetchGitSettingsSSR();
  return <GitHubGitSettingsClient initialData={initialData} />;
}
