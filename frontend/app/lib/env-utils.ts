/** Parse KEY=value lines (same rules as backend deploy env). */
export function parseServiceEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

/** First `replicas: N` in stack YAML (Swarm deploy block). */
export function parseYamlReplicas(config: string): number | null {
  const m = config.match(/replicas:\s*(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  return Math.min(10, Math.max(1, n));
}

/** Host port mapped to 5432 in generated Postgres stack, if `ports` is present. */
export function parseYamlPostgresPublishPort(config: string): number | null {
  const m = config.match(/ports:\s*\n\s*-\s*"(\d+):5432"/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

/** `image:` line under the first service in stack YAML. */
export function parseYamlPostgresImage(config: string): string | null {
  const m = config.match(/^\s*image:\s*(.+)$/m);
  if (!m) return null;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v || null;
}
