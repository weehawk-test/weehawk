import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type AuthProvider = "LOCAL" | "GOOGLE";

export type UserProfile = {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  provider: AuthProvider;
  emailVerified: boolean;
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

const jsonHeaders: HeadersInit = {
  Accept: "application/json",
};

export async function getProfile(): Promise<UserProfile> {
  const res = await authFetch(null, `${API_BASE}/api/user/profile`, {
    method: "GET",
    headers: jsonHeaders,
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function updateProfile(body: {
  firstName: string;
  lastName: string;
}): Promise<UserProfile> {
  const res = await authFetch(null, `${API_BASE}/api/user/profile`, {
    method: "PUT",
    headers: {
      ...jsonHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function changePassword(body: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ message: string }> {
  const res = await authFetch(null, `${API_BASE}/api/user/password`, {
    method: "PUT",
    headers: {
      ...jsonHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
