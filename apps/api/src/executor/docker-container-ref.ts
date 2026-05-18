/** Match Docker short/full container IDs returned by `docker ps -q` / `compose ps -q`. */
export function isDockerContainerId(value: string): boolean {
  const t = value.trim();
  return /^[a-f0-9]{12,64}$/i.test(t);
}

const DOCKER_CONTAINER_ID_IN_LINE = /\b([a-f0-9]{12,64})\b/i;

/**
 * Pick the first container ID from CLI stdout (ignores warnings / extra lines).
 */
export function extractDockerContainerIdFromOutput(text: string): string | null {
  for (const line of (text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (isDockerContainerId(t)) return t.toLowerCase();
    const m = t.match(DOCKER_CONTAINER_ID_IN_LINE);
    if (m?.[1] && isDockerContainerId(m[1])) return m[1].toLowerCase();
  }
  return null;
}

/** Non-hex token that may be a Docker container name (e.g. template `container_name`). */
export function looksLikeDockerContainerName(value: string): boolean {
  const t = value.trim();
  if (!t || isDockerContainerId(t)) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(t);
}

export function firstNonEmptyCliLine(text: string): string {
  for (const line of (text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#')) return t;
  }
  return '';
}
