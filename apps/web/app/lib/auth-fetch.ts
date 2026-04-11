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
 * Authenticated fetch: on 401, tries POST /api/auth/refresh once (cookies),
 * then retries so expired JWTs do not strand the UI.
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

/**
 * POST `multipart/form-data` with cookie auth and optional upload progress (browser only).
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
      xhr.withCredentials = true;
      xhr.open("POST", url);
      xhr.setRequestHeader("Accept", "application/json");
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
          void refreshTokensOnce().then((ok) => {
            if (ok) {
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
