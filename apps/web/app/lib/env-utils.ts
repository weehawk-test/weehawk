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

/** First `ports: - "host:container"` in application stack YAML (same pattern as API `extractApplicationComposeRegenerationArgs`). */
export function parseApplicationYamlPorts(config: string): {
  containerPort: number;
  publishPort: number;
} | null {
  const m = config.match(/ports:\s*\n\s*-\s*"(\d+):(\d+)"/);
  if (!m) return null;
  const publishPort = parseInt(m[1], 10);
  const containerPort = parseInt(m[2], 10);
  if (Number.isNaN(publishPort) || Number.isNaN(containerPort)) return null;
  return { containerPort, publishPort };
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

/** `# deployMode: source | image` from generated application stack header. */
export function parseApplicationDeployMode(config: string): "source" | "image" | null {
  const m = config.match(/^\s*#\s*deployMode:\s*(source|image)\s*$/im);
  if (!m?.[1]) return null;
  return m[1].toLowerCase() === "image" ? "image" : "source";
}

/** `# imageRef: ...` when deploying a pre-built image (not built from ZIP). */
export function parseApplicationImageRef(config: string): string | null {
  const m = config.match(/^\s*#\s*imageRef:\s*(.+)\s*$/im);
  if (!m?.[1]) return null;
  const v = m[1].trim();
  return v.length ? v : null;
}

/** `# buildMode: dockerfile | nixpacks` (legacy header `buildpacks` reads as nixpacks). */
export function parseApplicationBuildMode(config: string): "dockerfile" | "nixpacks" | null {
  const m = config.match(/^\s*#\s*buildMode:\s*(dockerfile|nixpacks|buildpacks)\s*$/im);
  if (!m?.[1]) return null;
  const v = m[1].toLowerCase();
  if (v === "nixpacks" || v === "buildpacks") return "nixpacks";
  return "dockerfile";
}

/** `# buildPath: ...` from generated application stack header. */
export function parseApplicationBuildPath(config: string): string | null {
  const m = config.match(/^\s*#\s*buildPath:\s*(.+)\s*$/im);
  if (!m?.[1]) return null;
  const v = m[1].trim();
  return v.length ? v : null;
}

/** Parsed from `# app.networks.*` headers (legacy single-network headers supported). */
export function parseApplicationNetworkHeaders(config: string): {
  external: string[];
  stack: string[];
} {
  const raw = config || "";
  const extLine = raw.match(/^\s*#\s*app\.networks\.external:\s*(.+)$/m);
  const stackLine = raw.match(/^\s*#\s*app\.networks\.stack:\s*(.+)$/m);
  if (extLine || stackLine) {
    const external =
      extLine?.[1]
        ?.split("|")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const stack =
      stackLine?.[1]
        ?.split("|")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    return { external, stack };
  }
  const mode = raw.match(/^\s*#\s*network\.mode:\s*(\w+)\s*$/im)?.[1]?.toLowerCase();
  if (mode === "external") {
    const name = raw.match(/^\s*#\s*network\.name:\s*(.+)$/im)?.[1]?.trim();
    return { external: name ? [name] : [], stack: [] };
  }
  if (mode === "stack") {
    const key =
      raw.match(/^\s*#\s*network\.key:\s*(.+)$/im)?.[1]?.trim() || "app-network";
    return { external: [], stack: [key] };
  }
  return { external: [], stack: [] };
}

/** Parse `# app.store.KEY: env|secret` headers from generated application config. */
export function parseApplicationStoreHeaders(
  config: string,
): Record<string, "env" | "secret"> {
  const out: Record<string, "env" | "secret"> = {};
  for (const line of (config || "").split(/\r?\n/)) {
    const m = line.match(/^\s*#\s*app\.store\.([A-Z0-9_]+)\s*:\s*(env|secret)\s*$/i);
    if (!m?.[1] || !m?.[2]) continue;
    const key = m[1].trim();
    const store = m[2].toLowerCase() === "secret" ? "secret" : "env";
    out[key] = store;
  }
  return out;
}
