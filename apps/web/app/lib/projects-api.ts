import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";
import type { CreateProjectInput, Project } from "./schema";
import { getServerApiBase } from "./server-api";

export const PROJECTS_PAGE_SIZE = 9;

export type ProjectsPageResponse = {
  data: Project[];
  total: number;
  page: number;
  limit: number;
};

function nestErrorMessage(text: string, fallback: string): string {
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (typeof j.message === "string") return j.message;
    if (Array.isArray(j.message)) return j.message.join(", ");
  } catch {
    /* keep fallback */
  }
  return text.trim() || fallback;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = typeof window === "undefined" ? getServerApiBase() : API_BASE;
  const url = `${base}${path}`;
  const headers: HeadersInit = {
    Accept: "application/json",
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...init?.headers,
  };
  if (typeof window !== "undefined") {
    return authFetch("cookie-session", url, {
      ...init,
      cache: "no-store",
      headers,
    });
  }
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers,
  });
}

export function mapApiProjectToProject(raw: unknown): Project {
  const row = raw as Record<string, unknown>;
  const services = Array.isArray(row.services) ? row.services : [];
  const explicitCount =
    typeof row.serviceCount === "number" && Number.isFinite(row.serviceCount)
      ? Math.max(0, Math.floor(row.serviceCount))
      : undefined;
  const created = row.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();

  const orgPub = row.organizationPublicId;
  if (typeof orgPub !== "string" || orgPub.trim() === "") {
    throw new Error("Project response missing organizationPublicId");
  }
  return {
    id: String(row.id ?? ""),
    publicId:
      row.publicId == null || String(row.publicId).trim() === ""
        ? undefined
        : String(row.publicId),
    name: String(row.name ?? ""),
    description: typeof row.description === "string" ? row.description : "",
    createdAt,
    serviceCount: explicitCount ?? services.length,
    organizationPublicId: orgPub.trim(),
  };
}

export function parseProjectsPageResponse(text: string): ProjectsPageResponse {
  const json = JSON.parse(text) as {
    data?: unknown[];
    total?: number;
    page?: number;
    limit?: number;
  };
  if (!Array.isArray(json.data)) {
    return { data: [], total: 0, page: 1, limit: PROJECTS_PAGE_SIZE };
  }
  return {
    data: json.data.map(mapApiProjectToProject),
    total: typeof json.total === "number" && Number.isFinite(json.total) ? Math.max(0, json.total) : 0,
    page: typeof json.page === "number" && Number.isFinite(json.page) ? Math.max(1, json.page) : 1,
    limit:
      typeof json.limit === "number" && Number.isFinite(json.limit)
        ? Math.max(1, json.limit)
        : PROJECTS_PAGE_SIZE,
  };
}

export async function fetchProjectsPage(
  page = 1,
  limit = PROJECTS_PAGE_SIZE,
  q = "",
): Promise<ProjectsPageResponse> {
  const params = new URLSearchParams();
  params.set("page", String(Math.max(1, page)));
  params.set("limit", String(limit));
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  const res = await apiFetch(`/api/projects?${params.toString()}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return parseProjectsPageResponse(text);
}

export async function fetchProject(
  id: string,
): Promise<Project> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiProjectToProject(JSON.parse(text));
}

export async function createProjectApi(body: CreateProjectInput): Promise<Project> {
  const org = body.organizationPublicId.trim();
  if (!org) throw new Error("organizationPublicId is required");
  const res = await apiFetch("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: body.name,
      description: body.description?.trim() ? body.description.trim() : undefined,
      organizationPublicId: org,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiProjectToProject(JSON.parse(text));
}

export async function updateProjectApi(
  id: string,
  patch: Partial<Pick<Project, "name" | "description">>,
): Promise<Project> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.description !== undefined) body.description = patch.description;

  const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiProjectToProject(JSON.parse(text));
}

export async function deleteProjectApi(
  id: string,
): Promise<void> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
}
