import { Logger } from '@nestjs/common';

const logger = new Logger('CorsOrigin');

export type CorsOriginOption = boolean | string[];

function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Resolves `cors.origin` for Express and WebSocket gateways from `CORS_ORIGIN`.
 * When unset in production, returns `false` (deny cross-origin). In non-production, returns `true` (reflect Origin).
 */
export function resolveCorsOrigin(
  corsEnv: string | undefined,
  nodeEnv?: string,
  options?: { logWarnings?: boolean },
): CorsOriginOption {
  const logWarnings = options?.logWarnings !== false;
  const env = (nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase();
  const raw = corsEnv?.trim();
  if (!raw) {
    if (env === 'production') {
      if (logWarnings) {
        logger.warn(
          'CORS_ORIGIN is not set; browser requests from other origins are blocked. Set CORS_ORIGIN in .env (comma-separated URLs).',
        );
      }
      return false;
    }
    if (logWarnings) {
      logger.warn(
        'CORS_ORIGIN is not set; reflecting the request Origin (OK for local dev on any port). Set CORS_ORIGIN for production.',
      );
    }
    return true;
  }
  const lower = raw.toLowerCase();
  if (lower === '*' || lower === 'true') {
    if (env === 'production') {
      if (logWarnings) {
        logger.warn(
          'CORS_ORIGIN cannot be "*" or "true" in production; blocking cross-origin browser requests until explicit origins are configured.',
        );
      }
      return false;
    }
    return true;
  }
  const list = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return list.length > 0 ? list : false;
}

export function isRequestOriginAllowed(
  requestOrigin: string | undefined,
  corsEnv: string | undefined,
  nodeEnv?: string,
): boolean {
  const origin = requestOrigin?.trim();
  if (!origin) return false;
  const allowed = resolveCorsOrigin(corsEnv, nodeEnv, { logWarnings: false });
  if (allowed === false) return false;
  if (allowed === true) {
    const env = (nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase();
    return env !== 'production';
  }
  const needle = normalizeOrigin(origin);
  return allowed.map((v) => normalizeOrigin(v)).includes(needle);
}
