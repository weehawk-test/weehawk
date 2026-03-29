import { API_BASE } from "./api";

export type UserProfile = {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  imageUrl: string | null;
  createdAt: string;
  lastLogin: string | null;
};

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

function authHeaders(accessToken: string): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function getProfile(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/api/user/profile`, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function updateProfile(
  accessToken: string,
  body: { firstName: string; lastName: string },
): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/api/user/profile`, {
    method: "PUT",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
