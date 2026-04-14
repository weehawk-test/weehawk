import { API_BASE } from "./api";
import type { StoredAuthUser } from "./auth-storage";

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  imageUrl: string | null;
};

async function parseError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const json = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(json.message)) return json.message.join(", ");
    if (typeof json.message === "string") return json.message;
  } catch {
    // ignore JSON parse errors
  }
  return raw || res.statusText || `HTTP ${res.status}`;
}

function toStoredUser(auth: AuthResponse): StoredAuthUser {
  return {
    userId: auth.userId,
    email: auth.email,
    firstName: auth.firstName,
    lastName: auth.lastName,
    imageUrl: auth.imageUrl,
  };
}

export async function loginApi(input: {
  email: string;
  password: string;
}): Promise<{ auth: AuthResponse; user: StoredAuthUser }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const auth = (await res.json()) as AuthResponse;
  return { auth, user: toStoredUser(auth) };
}

export async function registerApi(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<{ auth: AuthResponse; user: StoredAuthUser }> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const auth = (await res.json()) as AuthResponse;
  return { auth, user: toStoredUser(auth) };
}

export async function logoutApi(input: { refreshToken: string; accessToken: string }) {
  const res = await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({ refreshToken: input.refreshToken }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function forgotPasswordApi(input: { email: string }): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { message: string };
}

export async function resetPasswordApi(input: {
  token: string;
  newPassword: string;
}): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { message: string };
}

