"use client";

export const AUTH_CHANGE_EVENT = "weehawk-auth-storage";
export const AUTH_ACCESS_TOKEN_KEY = "weehawk_access_token";
export const AUTH_REFRESH_TOKEN_KEY = "weehawk_refresh_token";
export const AUTH_USER_KEY = "weehawk_auth_user";
const ACCESS_TOKEN_COOKIE = "weehawk_access_token";

export type StoredAuthUser = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified?: boolean;
  imageUrl?: string | null;
};

export type StoredAuthSession = {
  accessToken: string;
  refreshToken: string;
  user: StoredAuthUser;
};

function notifyAuthChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  }
}

function setAccessTokenCookie(token: string | null) {
  if (typeof document === "undefined") return;
  if (!token) {
    document.cookie = `${ACCESS_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  document.cookie = `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax`;
}

export function readStoredSession(): StoredAuthSession | null {
  if (typeof window === "undefined") return null;
  const accessToken = localStorage.getItem(AUTH_ACCESS_TOKEN_KEY)?.trim();
  const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)?.trim();
  const userRaw = localStorage.getItem(AUTH_USER_KEY);
  if (!accessToken || !refreshToken || !userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as StoredAuthUser;
    if (!user?.email || !user?.userId) return null;
    return { accessToken, refreshToken, user };
  } catch {
    return null;
  }
}

export function writeStoredSession(session: StoredAuthSession) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, session.refreshToken);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
  setAccessTokenCookie(session.accessToken);
  notifyAuthChanged();
}

export function updateStoredAccessToken(accessToken: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, accessToken);
  setAccessTokenCookie(accessToken);
  notifyAuthChanged();
}

export function clearStoredSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  setAccessTokenCookie(null);
  notifyAuthChanged();
}

