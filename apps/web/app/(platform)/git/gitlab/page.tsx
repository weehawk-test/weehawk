import { fetchGitSettingsSSR } from "@/lib/server-fetch";
import { GitLabGitSettingsClient } from "./gitlab-client";

export default async function GitLabGitSettingsPage() {
  const initialData = await fetchGitSettingsSSR();
  return <GitLabGitSettingsClient initialData={initialData} />;
}
