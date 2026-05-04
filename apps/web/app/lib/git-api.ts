import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type GitSettingsPublic = {
  github: {
    appId: string | null;
    clientId: string | null;
    clientSecretSet: boolean;
    privateKeySet: boolean;
    webhookSecretSet: boolean;
    appSlug: string | null;
    installAppUrl: string | null;
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
  githubAppSlug: string;
  githubClientSecret: string;
  githubPrivateKey: string;
  githubWebhookSecret: string;
  gitlabBaseUrl: string;
  gitlabGroupAccessToken: string;
}>;

function requireOrgPublicId(organizationPublicId: string): string {
  const t = organizationPublicId.trim();
  if (!t) throw new Error("organizationPublicId is required");
  return t;
}

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

function createApiUrl(path: string): URL {
  const base =
    API_BASE ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  return new URL(path, base);
}

export async function fetchGitSettings(
  accessToken: string,
  organizationPublicId: string,
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(organizationPublicId);
  const u = createApiUrl("/api/git/settings");
  u.searchParams.set("organizationPublicId", org);
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
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
  organizationPublicId: string,
  params?: { page?: number; perPage?: number; search?: string },
): Promise<GitlabProjectsListResponse> {
  const org = requireOrgPublicId(organizationPublicId);
  const u = createApiUrl("/api/git/gitlab/projects");
  u.searchParams.set("organizationPublicId", org);
  if (params?.page != null) u.searchParams.set("page", String(params.page));
  if (params?.perPage != null) u.searchParams.set("perPage", String(params.perPage));
  if (params?.search?.trim()) u.searchParams.set("search", params.search.trim());
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitlabProjectsListResponse>;
}

export async function fetchGitlabBranches(
  accessToken: string,
  organizationPublicId: string,
  projectId: number,
): Promise<{ branches: string[] }> {
  const org = requireOrgPublicId(organizationPublicId);
  const u = createApiUrl(
    `/api/git/gitlab/projects/${encodeURIComponent(String(projectId))}/branches`,
  );
  u.searchParams.set("organizationPublicId", org);
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<{ branches: string[] }>;
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

export async function fetchGithubRepositories(
  accessToken: string,
  organizationPublicId: string,
  params?: { page?: number; perPage?: number; search?: string },
): Promise<GithubRepositoriesListResponse> {
  const org = requireOrgPublicId(organizationPublicId);
  const u = createApiUrl("/api/git/github/repositories");
  u.searchParams.set("organizationPublicId", org);
  if (params?.page != null) u.searchParams.set("page", String(params.page));
  if (params?.perPage != null) u.searchParams.set("perPage", String(params.perPage));
  if (params?.search?.trim()) u.searchParams.set("search", params.search.trim());
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GithubRepositoriesListResponse>;
}

export async function fetchGithubBranches(
  accessToken: string,
  organizationPublicId: string,
  params: { installationId: number; repo: string },
): Promise<{ branches: string[] }> {
  const org = requireOrgPublicId(organizationPublicId);
  const u = createApiUrl("/api/git/github/branches");
  u.searchParams.set("organizationPublicId", org);
  u.searchParams.set("installationId", String(params.installationId));
  u.searchParams.set("repo", params.repo.trim());
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<{ branches: string[] }>;
}

/** Shape of GET /api/git/github/manifest (public; used for GitHub’s POST manifest registration). */
export type GithubAppManifest = {
  name: string;
  url: string;
  description: string;
  hook_attributes: { url: string };
  redirect_url: string;
  callback_urls: string[];
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
};

export async function fetchPublicGithubAppManifest(
  organizationPublicId: string,
): Promise<GithubAppManifest> {
  const org = requireOrgPublicId(organizationPublicId);
  const u = createApiUrl("/api/git/github/manifest");
  u.searchParams.set("organizationPublicId", org);
  const res = await fetch(u.toString(), {
    method: "GET",
    credentials: "omit",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GithubAppManifest>;
}

export async function updateGitSettings(
  accessToken: string,
  organizationPublicId: string,
  payload: UpdateGitSettingsPayload,
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(organizationPublicId);
  const u = createApiUrl("/api/git/settings");
  u.searchParams.set("organizationPublicId", org);
  const res = await authFetch(accessToken, u.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}

export async function exchangeGithubManifest(
  accessToken: string,
  organizationPublicId: string,
  code: string,
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(organizationPublicId);
  const res = await authFetch(accessToken, `${API_BASE}/api/git/github/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, organizationPublicId: org }),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}
