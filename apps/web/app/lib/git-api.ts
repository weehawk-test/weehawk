import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type GitSettingsPublic = {
  github: {
    activePublicId: string | null;
    appId: string | null;
    clientId: string | null;
    clientSecretSet: boolean;
    privateKeySet: boolean;
    webhookSecretSet: boolean;
    appSlug: string | null;
    installAppUrl: string | null;
  };
  gitlab: {
    activePublicId: string | null;
    baseUrl: string | null;
    groupAccessTokenSet: boolean;
  };
  githubAccounts: { publicId: string; name: string; isActive: boolean; createdAt: string | null }[];
  gitlabAccounts: { publicId: string; name: string; isActive: boolean; createdAt: string | null }[];
  updatedAt: string | null;
};

export type UpdateGitSettingsPayload = Partial<{
  provider: "github" | "gitlab";
  accountPublicId: string;
  accountName: string;
  createNewAccount: boolean;
  githubAppId: string;
  githubClientId: string;
  githubAppSlug: string;
  githubClientSecret: string;
  githubPrivateKey: string;
  githubWebhookSecret: string;
  gitlabBaseUrl: string;
  gitlabGroupAccessToken: string;
}>;

function requireOrgPublicId(activeOrgPublicId: string): string {
  const t = activeOrgPublicId.trim();
  if (!t) throw new Error("activeOrgPublicId is required");
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
  activeOrgPublicId: string,
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(activeOrgPublicId);
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
  activeOrgPublicId: string,
  params?: { accountPublicId?: string; page?: number; perPage?: number; search?: string },
): Promise<GitlabProjectsListResponse> {
  const org = requireOrgPublicId(activeOrgPublicId);
  const u = createApiUrl("/api/git/gitlab/projects");
  u.searchParams.set("organizationPublicId", org);
  if (params?.accountPublicId?.trim()) {
    u.searchParams.set("accountPublicId", params.accountPublicId.trim());
  }
  if (params?.page != null) u.searchParams.set("page", String(params.page));
  if (params?.perPage != null) u.searchParams.set("perPage", String(params.perPage));
  if (params?.search?.trim()) u.searchParams.set("search", params.search.trim());
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitlabProjectsListResponse>;
}

export async function fetchGitlabBranches(
  accessToken: string,
  activeOrgPublicId: string,
  projectId: number,
  accountPublicId?: string,
): Promise<{ branches: string[] }> {
  const org = requireOrgPublicId(activeOrgPublicId);
  const u = createApiUrl(
    `/api/git/gitlab/projects/${encodeURIComponent(String(projectId))}/branches`,
  );
  u.searchParams.set("organizationPublicId", org);
  if (accountPublicId?.trim()) u.searchParams.set("accountPublicId", accountPublicId.trim());
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
  activeOrgPublicId: string,
  params?: { accountPublicId?: string; page?: number; perPage?: number; search?: string },
): Promise<GithubRepositoriesListResponse> {
  const org = requireOrgPublicId(activeOrgPublicId);
  const u = createApiUrl("/api/git/github/repositories");
  u.searchParams.set("organizationPublicId", org);
  if (params?.accountPublicId?.trim()) {
    u.searchParams.set("accountPublicId", params.accountPublicId.trim());
  }
  if (params?.page != null) u.searchParams.set("page", String(params.page));
  if (params?.perPage != null) u.searchParams.set("perPage", String(params.perPage));
  if (params?.search?.trim()) u.searchParams.set("search", params.search.trim());
  const res = await authFetch(accessToken, u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GithubRepositoriesListResponse>;
}

export async function fetchGithubBranches(
  accessToken: string,
  activeOrgPublicId: string,
  params: { installationId: number; repo: string; accountPublicId?: string },
): Promise<{ branches: string[] }> {
  const org = requireOrgPublicId(activeOrgPublicId);
  const u = createApiUrl("/api/git/github/branches");
  u.searchParams.set("organizationPublicId", org);
  if (params.accountPublicId?.trim()) {
    u.searchParams.set("accountPublicId", params.accountPublicId.trim());
  }
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
  setup_url?: string;
  redirect_url: string;
  callback_urls: string[];
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
};

export async function fetchPublicGithubAppManifest(
  activeOrgPublicId: string,
): Promise<GithubAppManifest> {
  const org = requireOrgPublicId(activeOrgPublicId);
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
  activeOrgPublicId: string,
  payload: UpdateGitSettingsPayload,
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(activeOrgPublicId);
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

export async function createGitAccount(
  accessToken: string,
  activeOrgPublicId: string,
  payload: {
    provider: "github" | "gitlab";
    accountName: string;
    gitlabBaseUrl?: string;
    gitlabGroupAccessToken?: string;
  },
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(activeOrgPublicId);
  const u = createApiUrl("/api/git/accounts");
  u.searchParams.set("organizationPublicId", org);
  const res = await authFetch(accessToken, u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}

export async function deleteGitAccount(
  accessToken: string,
  activeOrgPublicId: string,
  accountPublicId: string,
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(activeOrgPublicId);
  const pid = accountPublicId.trim();
  if (!pid) throw new Error("accountPublicId is required");
  const u = createApiUrl(`/api/git/accounts/${encodeURIComponent(pid)}`);
  u.searchParams.set("organizationPublicId", org);
  const res = await authFetch(accessToken, u.toString(), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}

export async function exchangeGithubManifest(
  accessToken: string,
  activeOrgPublicId: string,
  code: string,
): Promise<GitSettingsPublic> {
  const org = requireOrgPublicId(activeOrgPublicId);
  const res = await authFetch(accessToken, `${API_BASE}/api/git/github/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, organizationPublicId: org }),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json() as Promise<GitSettingsPublic>;
}
