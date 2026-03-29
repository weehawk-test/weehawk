import { API_BASE } from "./api";
import type { AuthResponse } from "./auth-api";

export const AUTH_STORAGE_KEY = "weehawk_auth";
export const AUTH_CHANGE_EVENT = "weehawk-auth-storage";

let refreshInFlight: Promise<boolean> | null = null;

function persistAuthResponse(res: AuthResponse) {
  const user = { email: res.email, firstName: res.firstName, lastName: res.lastName };
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      user,
    }),
  );
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

/** Single-flight refresh so parallel 401s share one /refresh call. */
async function refreshTokensOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return false;
      let refreshToken: string | undefined;
      try {
        refreshToken = JSON.parse(raw).refreshToken;
      } catch {
        return false;
      }
      if (!refreshToken) return false;

      const r = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!r.ok) return false;
      const data = (await r.json()) as AuthResponse;
      persistAuthResponse(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Authenticated fetch: on 401, tries POST /api/auth/refresh once, updates localStorage,
 * then retries with the new access token (so expired JWTs do not strand the UI).
 */
export async function authFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const run = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    return fetch(url, { ...init, headers });
  };

  let res = await run(accessToken);
  if (res.status !== 401 || typeof window === "undefined") return res;

  const ok = await refreshTokensOnce();
  if (!ok) return res;

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY) ?? "";
    const at = JSON.parse(raw).accessToken as string | undefined;
    if (at) res = await run(at);
  } catch {
    /* keep first 401 response */
  }
  return res;
}
