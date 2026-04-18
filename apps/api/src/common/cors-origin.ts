import { Logger } from '@nestjs/common';

const logger = new Logger('CorsOrigin');

export type CorsOriginOption = boolean | string[];

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
    return true;
  }
  const list = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return list.length > 0 ? list : false;
}
