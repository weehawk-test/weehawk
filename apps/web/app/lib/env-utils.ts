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

export function parseYamlPublishPort(config: string, containerPort: number): number | null {
  const m = config.match(new RegExp(`ports:\\s*\\n\\s*-\\s*"(\\d+):${containerPort}"`));
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

export function parseYamlImage(config: string): string | null {
  return parseYamlPostgresImage(config);
}

/** `# buildMode: dockerfile | nixpacks` from generated application stack header. */
export function parseApplicationBuildMode(config: string): "dockerfile" | "nixpacks" | null {
  const m = config.match(/^\s*#\s*buildMode:\s*(dockerfile|nixpacks)\s*$/im);
  if (!m?.[1]) return null;
  return m[1].toLowerCase() === "nixpacks" ? "nixpacks" : "dockerfile";
}

/** `# buildPath: ...` from generated application stack header. */
export function parseApplicationBuildPath(config: string): string | null {
  const m = config.match(/^\s*#\s*buildPath:\s*(.+)\s*$/im);
  if (!m?.[1]) return null;
  const v = m[1].trim();
  return v.length ? v : null;
}
