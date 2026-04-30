/** Path segment used for public webhook triggers. */
export const WEEHAWK_WEBHOOK_PUBLIC_PATH_PREFIX = 'weehawk-hooks';

export function deriveHooksPublicHost(userDomainOrHost: string): string {
  const t = userDomainOrHost
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, '');
  return t;
}

/** Display value equals stored host (no forced webhook subdomain). */
export function hooksPublicHostForDisplay(stored: string | null | undefined): string {
  if (stored == null || !String(stored).trim()) {
    return '';
  }
  return String(stored).trim().toLowerCase();
}

/** Strip optional :port (and bracketed IPv6) from Host header. */
export function hostHeaderHostname(hostHeader: string | undefined): string {
  const raw = (hostHeader ?? '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('[')) {
    const j = raw.indexOf(']');
    if (j !== -1) {
      return raw.slice(1, j);
    }
  }
  const colon = raw.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(raw.slice(colon + 1))) {
    return raw.slice(0, colon);
  }
  return raw;
}

/** Path-only check: `GET|POST /weehawk-hooks/{64-hex token}` (public trigger; token is the secret). */
export function isPublicHooksTriggerPath(pathname: string | undefined): boolean {
  const raw = (pathname ?? '').trim();
  const p = raw.split('?')[0] ?? '';
  return new RegExp(`^/${WEEHAWK_WEBHOOK_PUBLIC_PATH_PREFIX}/[a-f0-9]{64}/?$`, 'i').test(p);
}

export function isPublicWebhookHostAllowed(
  hostHeader: string | undefined,
  opts: { allowAnyHost: boolean; allowLoopback: boolean; allowedHosts?: string[] },
): boolean {
  if (opts.allowAnyHost) {
    return true;
  }
  const host = hostHeaderHostname(hostHeader);
  if (!host) {
    return false;
  }
  if (
    opts.allowLoopback &&
    (host === 'localhost' || host === '127.0.0.1' || host === '::1')
  ) {
    return true;
  }
  const allowed = (opts.allowedHosts ?? [])
    .map((h) => hostHeaderHostname(h))
    .filter(Boolean);
  if (allowed.length === 0) {
    return false;
  }
  return allowed.includes(host);
}
