/**
 * Public web origin for API calls (scheme + host, optional port). No trailing slash.
 * Paths in this app are built as `${API_BASE}/api/...` (Nest routes live under `/api/...`).
 * If deploy sets `NEXT_PUBLIC_API_URL` to the reverse-proxy root `https://app.example/api`,
 * strip the trailing `/api` so we do not request `/api/api/...`.
 */
export function normalizeApiBase(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (u.toLowerCase().endsWith("/api")) {
    u = u.slice(0, -4).replace(/\/+$/, "");
  }
  return u || "http://localhost:8080";
}

export const API_BASE = normalizeApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
);
