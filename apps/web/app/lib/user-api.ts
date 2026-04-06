import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type UserProfile = {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  authProvider: string;
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

function authHeaders(_accessToken: string): HeadersInit {
  return {
    Accept: "application/json",
  };
}

export async function getProfile(accessToken: string): Promise<UserProfile> {
  const res = await authFetch(accessToken, `${API_BASE}/api/user/profile`, {
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
  const res = await authFetch(accessToken, `${API_BASE}/api/user/profile`, {
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

export async function changePassword(
  accessToken: string,
  body: { currentPassword: string; newPassword: string },
): Promise<{ message: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/user/password`, {
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

export async function requestEmailChange(
  accessToken: string,
  newEmail: string,
): Promise<{ message: string }> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/user/email/change-request`,
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ newEmail: newEmail.trim().toLowerCase() }),
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function resendConfirmationEmail(
  accessToken: string,
): Promise<{ message: string }> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/user/email/resend-confirmation`,
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
