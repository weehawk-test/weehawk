import { API_BASE } from "./api";
export const AUTH_CHANGE_EVENT = "weehawk-auth-storage";

let refreshInFlight: Promise<boolean> | null = null;

/** Single-flight refresh so parallel 401s share one /refresh call. */
async function refreshTokensOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const r = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (!r.ok) return false;
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
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
  _accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const run = () => {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    return fetch(url, { ...init, headers, credentials: "include" });
  };

  let res = await run();
  if (res.status !== 401 || typeof window === "undefined") return res;

  const ok = await refreshTokensOnce();
  if (!ok) return res;

  res = await run();
  return res;
}
