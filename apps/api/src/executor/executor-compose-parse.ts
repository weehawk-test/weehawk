export function parseConfigHeaderValue(config: string, key: string): string | null {
  const m = config.match(new RegExp(`^\\s*#\\s*${key}:\\s*(.+)$`, 'm'));
  return m?.[1]?.trim() || null;
}

/** First `services:` key in compose YAML (which service to exec into). */
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
