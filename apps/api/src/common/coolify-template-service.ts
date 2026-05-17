/** Detect Weehawk Coolify template services from stored `dockerConfig` headers. */

export function isCoolifyTemplateDockerConfig(dockerConfig: string): boolean {
  return /^\s*#\s*weehawk template service/m.test(dockerConfig || '');
}

export function parseCoolifyTemplateIdFromDockerConfig(
  dockerConfig: string,
): string | null {
  const m = (dockerConfig || '').match(/^\s*#\s*template:\s*([^\s#]+)/m);
  const id = m?.[1]?.trim();
  return id || null;
}

export function parseTemplatePortFromDockerConfig(
  dockerConfig: string,
): string | undefined {
  const m = (dockerConfig || '').match(/^\s*#\s*template\.port:\s*(\S+)/m);
  const p = m?.[1]?.trim();
  return p || undefined;
}

/** Compose body without Weehawk comment headers (for env extraction). */
export function composeBodyFromDockerConfig(dockerConfig: string): string {
  const raw = dockerConfig || '';
  const idx = raw.search(/^\s*services:\s*$/m);
  if (idx >= 0) return raw.slice(idx);
  return raw;
}
