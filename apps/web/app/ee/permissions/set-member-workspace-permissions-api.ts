import { API_BASE } from "@/lib/api";
import { authFetch } from "@/lib/auth-fetch";
import { getServerApiBase } from "@/lib/server-api";
import type { OrgWorkspacePermissionKey } from "@/lib/org-workspace-permissions";

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

export async function setMemberWorkspacePermissions(
  activeOrgPublicId: string,
  email: string,
  permissions: Partial<Record<OrgWorkspacePermissionKey, boolean>>,
): Promise<{ message: string }> {
  const id = activeOrgPublicId.trim();
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
