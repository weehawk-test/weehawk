import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type GitSettingsPublic = {
  github: {
    appId: string | null;
    clientId: string | null;
    clientSecretSet: boolean;
    privateKeySet: boolean;
    webhookSecretSet: boolean;
  };
  gitlab: {
    baseUrl: string | null;
    groupAccessTokenSet: boolean;
  };
  updatedAt: string | null;
};

export type UpdateGitSettingsPayload = Partial<{
  githubAppId: string;
  githubClientId: string;
  githubClientSecret: string;
  githubPrivateKey: string;
  githubWebhookSecret: string;
  gitlabBaseUrl: string;
  gitlabGroupAccessToken: string;
}>;

async function errorBody(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join(", ");
    if (typeof j.message === "string") return j.message;
  } catch {
    /* ignore */
  }
  return text || res.statusText;
}

export async function fetchGitSettings(accessToken: string): Promise<GitSettingsPublic> {
  const res = await authFetch(accessToken, `${API_BASE}/api/git/settings`, { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}

export type GitlabProjectListItem = {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  default_branch: string | null;
};

export type GitlabProjectsListResponse = {
  projects: GitlabProjectListItem[];
  totalPages: number;
  page: number;
};

export async function fetchGitlabProjects(
  accessToken: string,
  params?: { page?: number; perPage?: number; search?: string },
): Promise<GitlabProjectsListResponse> {
  const u = new URL(`${API_BASE}/api/git/gitlab/projects`);
  if (params?.page != null) u.searchParams.set("page", String(params.page));
  if (params?.perPage != null) u.searchParams.set("perPage", String(params.perPage));
  if (params?.search?.trim()) u.searchParams.set("search", params.search.trim());
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitlabProjectsListResponse>;
}

export type GithubRepoListItem = {
  id: number;
  full_name: string;
  clone_url: string;
  default_branch: string | null;
  private: boolean;
  installation_id: number;
};

export type GithubRepositoriesListResponse = {
  repositories: GithubRepoListItem[];
  totalPages: number;
  page: number;
};

/** Repositories visible to the configured GitHub App (all installations). */
export async function fetchGithubRepositories(
  accessToken: string,
  params?: { page?: number; perPage?: number; search?: string },
): Promise<GithubRepositoriesListResponse> {
  const u = new URL(`${API_BASE}/api/git/github/repositories`);
  if (params?.page != null) u.searchParams.set("page", String(params.page));
  if (params?.perPage != null) u.searchParams.set("perPage", String(params.perPage));
  if (params?.search?.trim()) u.searchParams.set("search", params.search.trim());
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GithubRepositoriesListResponse>;
}

export async function updateGitSettings(
  accessToken: string,
  payload: UpdateGitSettingsPayload,
): Promise<GitSettingsPublic> {
  const res = await authFetch(accessToken, `${API_BASE}/api/git/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}

/** After GitHub App manifest registration, exchanges `code` from the redirect query string. */
export async function exchangeGithubManifest(
  accessToken: string,
  code: string,
): Promise<GitSettingsPublic> {
  const res = await authFetch(accessToken, `${API_BASE}/api/git/github/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}
