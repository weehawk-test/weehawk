import { cookies, headers } from "next/headers";

/**
 * Forwards auth to the Weehawk API during SSR. Prefer `cookies()` (Next App Router) so
 * `httpOnly` session cookies are included; fall back to `headers().get("cookie")`.
 * Also forwards `Authorization` when present (e.g. reverse proxies).
 */
export async function buildServerApiCookieHeaders(): Promise<HeadersInit> {
  const h = await headers();
  const out: Record<string, string> = {
    Accept: "application/json",
  };
  const apiKey = (process.env.WEEHAWK_API_KEY ?? "").trim();
  if (apiKey) {
    out["X-Weehawk-Api-Key"] = apiKey;
  }

  try {
    const jar = await cookies();
    const all = jar.getAll();
    if (all.length > 0) {
      out.Cookie = all.map((c) => `${c.name}=${c.value}`).join("; ");
    }
    const accessToken = jar.get("weehawk_access_token")?.value;
    if (accessToken && !out.Authorization) {
      out.Authorization = `Bearer ${accessToken}`;
    }
  } catch {
    /* cookies() unavailable outside a request (or static render) */
  }

  if (!out.Cookie) {
    const raw = h.get("cookie");
    if (raw) out.Cookie = raw;
  }

  const authz = h.get("authorization");
  if (authz) out.Authorization = authz;

  return out;
}
