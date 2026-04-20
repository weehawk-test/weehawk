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

/**
 * WebSocket base should preserve any reverse-proxy path prefix from NEXT_PUBLIC_API_URL
 * (e.g. `/api`) so terminal gateways resolve to the correct upstream in production.
 */
export function wsBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
  if (raw) {
    if (/^https?:\/\//i.test(raw)) {
      return raw.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    }
    if (raw.startsWith("/")) {
      if (typeof window !== "undefined") {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${window.location.host}${raw}`;
      }
      return `ws://localhost:8080${raw}`;
    }
  }
  return API_BASE.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

/** Candidate WS bases: primary + `/api` fallback (or inverse), deduplicated. */
export function wsBaseCandidates(): string[] {
  const primary = wsBase().replace(/\/+$/, "");
  const out: string[] = [];
  const lower = primary.toLowerCase();
  if (lower.endsWith("/api")) {
    // Keep `/api` first for deployments where API and WS are namespaced.
    out.push(primary);
    out.push(primary.slice(0, -4).replace(/\/+$/, ""));
  } else {
    // Prefer `/api` first (common production reverse-proxy layout),
    // then fall back to root `/ws`.
    out.push(`${primary}/api`);
    out.push(primary);
  }
  return Array.from(new Set(out.filter(Boolean)));
}
