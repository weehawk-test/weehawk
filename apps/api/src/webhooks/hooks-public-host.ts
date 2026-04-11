/**
 * Traefik Host() for bash webhooks: always {@code weehawk-webhook.<user-domain>}.
 * User enters e.g. {@code example.com}; stored / routed host is {@code weehawk-webhook.example.com}.
 */
export const WEEHAWK_WEBHOOK_TRAEFIK_HOST_PREFIX = 'weehawk-webhook';

const PREFIX_DOT = `${WEEHAWK_WEBHOOK_TRAEFIK_HOST_PREFIX}.`;

export function deriveHooksPublicHost(userDomainOrHost: string): string {
  const t = userDomainOrHost
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, '');
  if (!t) {
    return '';
  }
  if (t.startsWith(PREFIX_DOT)) {
    return t;
  }
  return `${PREFIX_DOT}${t}`;
}

/** Strip the Weehawk prefix for form display (edit webhook). */
export function hooksPublicHostForDisplay(stored: string | null | undefined): string {
  if (stored == null || !String(stored).trim()) {
    return '';
  }
  const t = String(stored).trim().toLowerCase();
  if (t.startsWith(PREFIX_DOT)) {
    return t.slice(PREFIX_DOT.length);
  }
  return t;
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

/**
 * Public /hooks triggers (API or agent) must use a Host containing {@link WEEHAWK_WEBHOOK_TRAEFIK_HOST_PREFIX},
 * unless {@code allowAnyHost}. Loopback may be allowed for local development.
 */
/** Path-only check: `GET|POST /hooks/{64-hex token}` (public trigger; token is the secret). */
export function isPublicHooksTriggerPath(pathname: string | undefined): boolean {
  const raw = (pathname ?? '').trim();
  const p = raw.split('?')[0] ?? '';
  return /^\/hooks\/[a-f0-9]{64}\/?$/i.test(p);
}

export function isPublicWebhookHostAllowed(
  hostHeader: string | undefined,
  opts: { allowAnyHost: boolean; allowLoopback: boolean },
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
  return host.includes(WEEHAWK_WEBHOOK_TRAEFIK_HOST_PREFIX);
}
