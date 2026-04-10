/** Hostnames from deploy server `domainsJson` (Domains page). */
export function hostsFromRemoteServerDomainsJson(raw: string | null | undefined): string[] {
  if (raw == null || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
        .map((s) => s.trim());
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      if (Array.isArray(o.domains)) {
        return o.domains
          .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
          .map((s) => s.trim());
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}
