import type { Service } from "./schema";

/** Internal IDs used when saving (Docker attach targets). */
function parseConnectionTargetsForService(s: Service): { value: string; label: string }[] {
  if (!s.appName) return [];
  const keys: string[] = [];
  const lines = (s.config || "").split(/\r?\n/);
  let inNetworks = false;
  for (const line of lines) {
    if (!inNetworks) {
      if (/^networks:\s*$/.test(line)) inNetworks = true;
      continue;
    }
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s+/.test(line)) break;
    const m = line.match(/^\s{2}([a-zA-Z0-9_.-]+)\s*:\s*$/);
    if (m?.[1]) keys.push(m[1]);
  }
  if (keys.length === 0) return [];
  return keys.map((k) => ({
    value: `${s.appName}_${k}`,
    label: keys.length === 1 ? s.name : `${s.name} (${k})`,
  }));
}

export function buildDatabaseConnectionOptions(
  services: Service[],
  excludeServiceId?: string,
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    if (s.type !== "databases") continue;
    if (excludeServiceId && s.id === excludeServiceId) continue;
    for (const t of parseConnectionTargetsForService(s)) {
      if (seen.has(t.value)) continue;
      seen.add(t.value);
      out.push(t);
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

export function buildApplicationConnectionOptions(
  services: Service[],
  excludeServiceId?: string,
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    if (s.type !== "application") continue;
    if (excludeServiceId && s.id === excludeServiceId) continue;
    for (const t of parseConnectionTargetsForService(s)) {
      if (seen.has(t.value)) continue;
      seen.add(t.value);
      out.push(t);
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
