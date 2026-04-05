/**
 * Returns the registry hostname for Docker auth lookup (e.g. ghcr.io, docker.io).
 * Mirrors common Docker reference parsing: single-segment names use docker.io (library).
 */
export function registryHostFromImageRef(ref: string): string {
  const trimmed = ref.trim().split('@')[0];
  if (!trimmed) return 'docker.io';
  const lastColon = trimmed.lastIndexOf(':');
  const lastSlash = trimmed.lastIndexOf('/');
  const hasTag =
    lastColon > lastSlash &&
    lastColon !== trimmed.indexOf(':') &&
    !trimmed.slice(lastColon + 1).includes('/');
  const name = hasTag ? trimmed.slice(0, lastColon) : trimmed;
  const slash = name.indexOf('/');
  if (slash === -1) return 'docker.io';
  const first = name.slice(0, slash).toLowerCase();
  const looksLikeRegistry =
    first.includes('.') ||
    first === 'localhost' ||
    first.startsWith('[') ||
    /^[^:]+:[0-9]+$/.test(first);
  if (looksLikeRegistry) return first;
  return 'docker.io';
}

export function normalizeProviderUrl(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}
