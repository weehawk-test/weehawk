import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type AuthProvider = "LOCAL" | "GOOGLE";

export type UserProfile = {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  role?: string;
  provider: AuthProvider;
  providerId: string | null;
  /** Google sign-in email; may differ from `email` after changing account email in-app. */
  googleAccountEmail: string | null;
  hasPassword: boolean;
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
  const res = await authFetch(null, `${API_BASE}/api/auth/change-password`, {
    method: "POST",
    headers: {
      ...jsonHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function requestEmailChange(body: { newEmail: string }): Promise<{ message: string }> {
  const res = await authFetch(null, `${API_BASE}/api/user/change-email`, {
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

export async function confirmEmailChange(token: string): Promise<{ message: string }> {
  const params = new URLSearchParams({ token });
  const res = await fetch(`${API_BASE}/api/user/confirm-email-change?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

/** Initial registration email verification (public). */
export async function confirmEmail(token: string): Promise<{ message: string }> {
  const params = new URLSearchParams({ token });
  const res = await fetch(`${API_BASE}/api/auth/confirm-email?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

/** Resend registration confirmation email (authenticated). */
export async function resendConfirmationEmail(): Promise<{ message: string }> {
  const res = await authFetch(null, `${API_BASE}/api/auth/resend-confirmation`, {
    method: "POST",
    headers: jsonHeaders,
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function setPassword(body: { newPassword: string }): Promise<{ message: string }> {
  const res = await authFetch(null, `${API_BASE}/api/user/set-password`, {
    method: "POST",
    headers: {
      ...jsonHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function unlinkGoogle(): Promise<{ message: string }> {
  const res = await authFetch(null, `${API_BASE}/api/user/unlink-google`, {
    method: "DELETE",
    headers: {
      ...jsonHeaders,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function deleteAccount(): Promise<{ message: string }> {
  const res = await authFetch(null, `${API_BASE}/api/user/account`, {
    method: "DELETE",
    headers: jsonHeaders,
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
