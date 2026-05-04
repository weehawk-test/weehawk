import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";
import { getServerApiBase } from "./server-api";
import type {
  CreateOrganizationInput,
  OrganizationInviteAcceptResult,
  OrganizationMemberPublic,
  OrganizationProjectListItem,
  OrganizationPublic,
  UpdateOrganizationInput,
} from "./organizations-types";
import type { OrgWorkspacePermissionKey } from "./org-workspace-permissions";
import { parseWorkspacePermissions } from "./org-workspace-permissions";

export type {
  CreateOrganizationInput,
  OrganizationInviteAcceptResult,
  OrganizationMemberPublic,
  OrganizationProjectListItem,
  OrganizationPublic,
  UpdateOrganizationInput,
} from "./organizations-types";

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

function mapOrg(raw: unknown): OrganizationPublic {
  const row = raw as Record<string, unknown>;
  const created = row.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();
  const mc = row.memberCount;
  const memberCount =
    typeof mc === "number" && Number.isFinite(mc) ? Math.max(1, Math.floor(mc)) : 1;
  return {
    publicId: String(row.publicId ?? ""),
    name: String(row.name ?? ""),
    isOwner: row.isOwner === true,
    createdAt,
    memberCount,
    workspacePermissions: parseWorkspacePermissions(row.workspacePermissions),
  };
}

export async function fetchOrganizations(): Promise<OrganizationPublic[]> {
  const res = await apiFetch("/api/organizations", { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map(mapOrg);
}

/** Organization owners may update the display name. */
export async function updateOrganization(
  organizationPublicId: string,
  body: UpdateOrganizationInput,
): Promise<OrganizationPublic> {
  const id = organizationPublicId.trim();
  if (!id) throw new Error("Organization id required");
  const res = await apiFetch(`/api/organizations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapOrg(JSON.parse(text) as unknown);
}

export async function fetchOrganization(publicId: string): Promise<OrganizationPublic | null> {
  const id = publicId.trim();
  if (!id) return null;
  const res = await apiFetch(`/api/organizations/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapOrg(JSON.parse(text) as unknown);
}

function mapMember(raw: unknown): OrganizationMemberPublic {
  const row = raw as Record<string, unknown>;
  return {
    email: String(row.email ?? ""),
    firstName: String(row.firstName ?? ""),
    lastName: String(row.lastName ?? ""),
    isOwner: row.isOwner === true,
    joinedAt:
      row.joinedAt instanceof Date
        ? row.joinedAt.toISOString()
        : String(row.joinedAt ?? new Date().toISOString()),
    workspacePermissions: parseWorkspacePermissions(row.workspacePermissions),
  };
}

export async function setMemberWorkspacePermissions(
  organizationPublicId: string,
  email: string,
  permissions: Partial<Record<OrgWorkspacePermissionKey, boolean>>,
): Promise<{ message: string }> {
  const id = organizationPublicId.trim();
  if (!id) throw new Error("Organization id required");
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(id)}/members/permissions`,
    {
      method: "PATCH",
      body: JSON.stringify({ email: email.trim().toLowerCase(), permissions }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown as { message?: string };
  return {
    message: typeof data.message === "string" ? data.message : "Permissions updated.",
  };
}

function mapOrgProject(raw: unknown): OrganizationProjectListItem {
  const row = raw as Record<string, unknown>;
  const created = row.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();
  const sc = row.serviceCount;
  const serviceCount =
    typeof sc === "number" && Number.isFinite(sc) ? Math.max(0, Math.floor(sc)) : 0;
  return {
    publicId: String(row.publicId ?? ""),
    name: String(row.name ?? ""),
    description: typeof row.description === "string" ? row.description : "",
    createdAt,
    serviceCount,
  };
}

export async function fetchOrganizationMembers(
  organizationPublicId: string,
): Promise<OrganizationMemberPublic[]> {
  const id = organizationPublicId.trim();
  if (!id) return [];
  const res = await apiFetch(`/api/organizations/${encodeURIComponent(id)}/members`, {
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map(mapMember);
}

export async function fetchOrganizationProjects(
  organizationPublicId: string,
): Promise<OrganizationProjectListItem[]> {
  const id = organizationPublicId.trim();
  if (!id) return [];
  const res = await apiFetch(`/api/organizations/${encodeURIComponent(id)}/projects`, {
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map(mapOrgProject);
}

/** Organization owners may promote a member to owner or demote an owner to member (API enforces at least one owner). */
export async function setOrganizationMemberRole(
  organizationPublicId: string,
  email: string,
  role: "owner" | "member",
): Promise<{ message: string }> {
  const id = organizationPublicId.trim();
  if (!id) throw new Error("Organization id required");
  const res = await apiFetch(`/api/organizations/${encodeURIComponent(id)}/ownership`, {
    method: "PATCH",
    body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown as { message?: string };
  return {
    message: typeof data.message === "string" ? data.message : "Role updated.",
  };
}

/** Sends invitation email; invitee accepts via link while signed in as that email. */
export async function inviteOrganizationMember(
  organizationPublicId: string,
  email: string,
): Promise<{ message: string; notice?: string }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationPublicId.trim())}/members`,
    {
      method: "POST",
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown as { message?: string; notice?: string };
  return {
    message: typeof data.message === "string" ? data.message : "Invitation sent.",
    notice: typeof data.notice === "string" && data.notice.trim() !== "" ? data.notice : undefined,
  };
}

function mapInviteAccept(raw: unknown): OrganizationInviteAcceptResult {
  const m = mapMember(raw);
  const row = raw as Record<string, unknown>;
  return {
    ...m,
    organizationPublicId: String(row.organizationPublicId ?? ""),
    organizationName: String(row.organizationName ?? ""),
  };
}

/** Accept invite (authenticated; session email must match invitation). */
export async function acceptOrganizationInvite(token: string): Promise<OrganizationInviteAcceptResult> {
  const res = await apiFetch("/api/organizations/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token: token.trim() }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapInviteAccept(JSON.parse(text) as unknown);
}

/** Leave organization (members and owners; API transfers ownership or dissolves the org when needed). */
export async function leaveOrganization(organizationPublicId: string): Promise<{ message: string }> {
  const id = organizationPublicId.trim();
  if (!id) throw new Error("Organization id required");
  const res = await apiFetch(`/api/organizations/${encodeURIComponent(id)}/membership`, {
    method: "DELETE",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown as { message?: string };
  return { message: typeof data.message === "string" ? data.message : "You left the organization." };
}

export async function createOrganization(
  body: CreateOrganizationInput,
): Promise<OrganizationPublic> {
  const res = await apiFetch("/api/organizations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapOrg(JSON.parse(text) as unknown);
}

/** Browser-only: workspace switcher / sidebar listen and refetch GET /api/organizations. */
export const ORGANIZATIONS_LIST_CHANGED_EVENT = "weehawk-organizations-changed";

export function notifyOrganizationsListChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ORGANIZATIONS_LIST_CHANGED_EVENT));
}
