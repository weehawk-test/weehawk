export function parseConfigHeaderValue(
  config: string,
  key: string,
): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = config.match(new RegExp(`^\\s*#\\s*${escaped}:\\s*(.+)$`, 'm'));
  return m?.[1]?.trim() || null;
}

/**
 * Optional override: `# nixpacks.nodeVersion: 22` in service compose headers.
 * If unset, {@link resolveNixpacksNodeMajorForRemoteBuild} uses {@link WEEHAWK_DEFAULT_NIXPACKS_NODE_MAJOR}.
 */
export function parseNixpacksNodeMajorFromConfigHeader(
  config: string,
): string | null {
  const raw = parseConfigHeaderValue(config, 'nixpacks.nodeVersion')?.trim();
  if (!raw) return null;
  const major = raw.replace(/^v/i, '').trim();
  if (!/^\d{1,2}$/.test(major)) return null;
  const n = Number(major);
  if (n < 16 || n > 30) return null;
  return major;
}

/** Default Node major for Nixpacks on remote hosts (Next.js 16+ and current LTS expectations). */
export const WEEHAWK_DEFAULT_NIXPACKS_NODE_MAJOR = '20';

export function resolveNixpacksNodeMajorForRemoteBuild(config: string): string {
  return (
    parseNixpacksNodeMajorFromConfigHeader(config) ??
    WEEHAWK_DEFAULT_NIXPACKS_NODE_MAJOR
  );
}

/** First `services:` key in compose YAML (which service to exec into). */
/** First `image:` under a service block (indented) — for registry auth on `docker stack deploy --with-registry-auth`. */
export function firstImageRefFromComposeYaml(yaml: string): string | null {
  for (const line of yaml.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('#')) continue;
    const m = line.match(/^\s+image:\s*(.+)$/);
    if (!m) continue;
    let ref = m[1].trim();
    if (
      (ref.startsWith('"') && ref.endsWith('"')) ||
      (ref.startsWith("'") && ref.endsWith("'"))
    ) {
      ref = ref.slice(1, -1);
    }
    const word = ref.split(/\s+/)[0];
    return word || null;
  }
  return null;
}

export function firstComposeServiceName(config: string): string {
  const lines = config.split(/\r?\n/);
  let inServices = false;
  let servicesIndent = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!inServices) {
      if (t === 'services:' || /^\s*services:\s*$/.test(line)) {
        inServices = true;
        servicesIndent = line.match(/^\s*/)?.[0]?.length ?? 0;
      }
      continue;
    }
    if (!t || t.startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
    if (indent <= servicesIndent) break;
    const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*:/);
    if (m && indent > servicesIndent) return m[1];
  }
  return 'app';
}

/** Container port from `ports: - "host:container"` in stack compose (application services). */
export function parseContainerPortFromComposeYaml(
  config: string,
): number | null {
  const m = config.match(/^\s*-\s*"(\d+):(\d+)"/m);
  if (!m) return null;
  const c = parseInt(m[2], 10);
  return Number.isFinite(c) && c > 0 ? c : null;
}

export function parseEnv(envString: string): Record<string, string> {
  const envVars: Record<string, string> = {};
  if (!envString) return envVars;

  envString.split('\n').forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  return envVars;
}
