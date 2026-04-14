import { API_BASE } from "./api";
import {
  clearStoredSession,
  readStoredSession,
  updateStoredAccessToken,
  writeStoredSession,
} from "./auth-storage";

let refreshInFlight: Promise<string | null> | null = null;

/** Single-flight refresh so parallel 401s share one /refresh call. */
async function refreshTokensOnce(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const current = readStoredSession();
      if (!current?.refreshToken) return null;
      const r = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!r.ok) {
        clearStoredSession();
        return null;
      }
      const next = (await r.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      writeStoredSession({
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        user: current.user,
      });
      return next.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Authenticated fetch: on 401, tries POST /api/auth/refresh once,
 * then retries so expired JWTs do not strand the UI.
 */
export async function authFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const run = (token: string) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  let res = await run(accessToken);
  if (res.status !== 401 || typeof window === "undefined") return res;

  const nextAccessToken = await refreshTokensOnce();
  if (!nextAccessToken) return res;

  updateStoredAccessToken(nextAccessToken);
  res = await run(nextAccessToken);
  return res;
}

/**
 * POST `multipart/form-data` with bearer auth and optional upload progress (browser only).
 * Mirrors {@link authFetch} 401 → refresh → retry once. Returns response body text.
 */
export async function authFormDataUploadWithProgress(
  url: string,
  formData: FormData,
  onUploadProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Upload with progress is only available in the browser.");
  }

  const send = (isRetry: boolean): Promise<string> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Accept", "application/json");
      const token = readStoredSession()?.accessToken ?? "";
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }
      xhr.upload.onprogress = (e) => {
        if (!onUploadProgress) return;
        if (e.lengthComputable && e.total > 0) {
          onUploadProgress(e.loaded, e.total);
        } else {
          onUploadProgress(e.loaded, Math.max(e.loaded, 1));
        }
      };
      xhr.onload = () => {
        if (xhr.status === 401 && !isRetry) {
          void refreshTokensOnce().then((nextToken) => {
            if (nextToken) {
              void send(true).then(resolve).catch(reject);
            } else {
              reject(new Error(xhr.responseText || "Session expired (401)."));
            }
          });
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
          return;
        }
        resolve(xhr.responseText);
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(formData);
    });

  return send(false);
}
