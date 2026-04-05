export function parseConfigHeaderValue(config: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = config.match(new RegExp(`^\\s*#\\s*${escaped}:\\s*(.+)$`, 'm'));
  return m?.[1]?.trim() || null;
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
  for (const line of lines) {
    const t = line.trim();
    if (!inServices) {
      if (t === 'services:' || /^\s*services:\s*$/.test(line)) inServices = true;
      continue;
    }
    if (!t || t.startsWith('#')) continue;
    if (/^[a-zA-Z_]/.test(line) && !line.startsWith(' ')) break;
    const m = line.match(/^\s{2}([a-zA-Z0-9_.-]+)\s*:/);
    if (m) return m[1];
  }
  return 'app';
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
