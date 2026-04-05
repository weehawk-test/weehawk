import { API_BASE } from "./api";

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

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  /** Omitted in older cached sessions; treat as unverified. */
  emailVerified?: boolean;
  imageUrl: string | null;
  role?: string;
  provider?: string;
};

export type SetupStatus = {
  edition: "cloud" | "selfhosted";
  needsSetup: boolean;
  hasUsers: boolean;
};

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await fetch(`${API_BASE}/api/auth/setup-status`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function registerUser(body: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function loginUser(body: { email: string; password: string }): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function logoutApi(email?: string): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email }),
    credentials: "include",
  });
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token, newPassword }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function confirmEmail(token: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/confirm-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function confirmEmailChange(token: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/confirm-email-change`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
