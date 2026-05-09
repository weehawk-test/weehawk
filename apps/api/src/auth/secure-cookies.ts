import type { ConfigService } from '@nestjs/config';

/**
 * Whether to mark auth/session cookies `Secure`.
 *
 * Order:
 *  1. Explicit override `AUTH_COOKIE_SECURE` (true/false/1/0/yes/no).
 *  2. Scheme of the frontend origin (`WEBFRONTEND_BASE_URL` / `WEB_ORIGIN`):
 *     - `https://...` → secure=true
 *     - `http://localhost...` / `http://127....` → secure=false (so prod-on-localhost works).
 *  3. Fallback: `NODE_ENV === 'production'`.
 *
 * The third fallback is intentionally last: setting `Secure` on a plain-HTTP origin
 * makes browsers drop the cookie, which breaks SSR and infinite-redirects to
 * `/organizations/create`.
 */
export function resolveSecureCookies(config: ConfigService): boolean {
  const override = (config.get<string>('AUTH_COOKIE_SECURE') ?? '')
    .trim()
    .toLowerCase();
  if (override) {
    if (['true', '1', 'yes', 'on'].includes(override)) return true;
    if (['false', '0', 'no', 'off'].includes(override)) return false;
  }

  const frontendUrl = (
    config.get<string>('WEBFRONTEND_BASE_URL') ??
    config.get<string>('WEB_ORIGIN') ??
    ''
  ).trim();

  if (frontendUrl) {
    const lower = frontendUrl.toLowerCase();
    if (lower.startsWith('https://')) return true;
    if (lower.startsWith('http://')) return false;
  }

  const nodeEnv = (
    config.get<string>('NODE_ENV') ??
    process.env.NODE_ENV ??
    ''
  )
    .trim()
    .toLowerCase();
  return nodeEnv === 'production';
}
