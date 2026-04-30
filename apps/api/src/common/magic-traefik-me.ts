/**
 * Builds hostnames that resolve via traefik.me wildcard DNS (same idea as nip.io):
 * `prefix.rand.octets.traefik.me` → IPv4.
 *
 * @see https://traefik.me
 */
export function slugifySubdomainLabel(input: string): string {
  let s = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
  if (!s) s = 'app';
  if (!/^[a-z0-9]/.test(s)) s = `a${s}`;
  if (!/[a-z0-9]$/.test(s)) s = `${s}0`;
  if (s.length > 63) s = s.slice(0, 63).replace(/-+$/g, '') || 'app';
  return s;
}

export function parseIpv4Octets(
  raw: string,
): [number, number, number, number] | null {
  const t = raw.trim();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (!m) return null;
  const parts = [1, 2, 3, 4].map((i) => parseInt(m[i], 10));
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return parts as [number, number, number, number];
}

/**
 * `{projectSlug}-{serviceSlug}.{nonce}.{a}.{b}.{c}.{d}.traefik.me`
 * First label max 63 chars (DNS limit). `nonce` is 6 hex chars (user “dice roll”).
 */
export function buildTraefikMeMagicHostname(
  projectName: string,
  serviceName: string,
  nonce: string,
  ipv4: string,
): string | null {
  const n = nonce.trim().toLowerCase();
  if (!/^[a-f0-9]{6}$/.test(n)) return null;
  const octets = parseIpv4Octets(ipv4);
  if (!octets) return null;
  const p = slugifySubdomainLabel(projectName);
  const s = slugifySubdomainLabel(serviceName);
  let prefix = `${p}-${s}`;
  if (prefix.length > 63) {
    prefix = prefix.slice(0, 63).replace(/-+$/g, '') || 'app';
  }
  const [a, b, c, d] = octets;
  return `${prefix}.${n}.${a}.${b}.${c}.${d}.traefik.me`;
}
