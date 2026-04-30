import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Global internal API-key gate.
 * - Public/auth routes are excluded.
 * - Other routes require `X-Weehawk-Api-Key`.
 */
export function createSecretKeyMiddleware(config: ConfigService) {
  const HEADER_NAME = 'X-Weehawk-Api-Key';
  const FORBIDDEN_JSON =
    '{"status":403,"error":"Forbidden","message":"Invalid or missing API key"}';

  const EXCLUDED_PREFIXES = [
    '/api/auth',
    '/oauth2/',
    '/api/oauth2/',
    '/login/oauth2/',
    '/api/login/oauth2/',
    '/swagger',
    '/swagger-ui',
    '/swagger-json',
    '/v3/api-docs',
    '/weehawk-hooks/', // public webhook trigger endpoint
    '/api/user/confirm-email-change',
    // GitHub App setup: GitHub servers GET the manifest (no API key); webhooks POST with signature only.
    '/api/git/github/manifest',
    '/api/git/github/webhook',
  ];

  const apiKeyMatches = (actual: string, expected: string): boolean => {
    const actualBuf = Buffer.from(actual, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (actualBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(actualBuf, expectedBuf);
  };

  const normalizePath = (req: Request): string => {
    let raw = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        raw = new URL(raw).pathname;
      } catch {
        return '/';
      }
    }
    if (!raw.startsWith('/')) raw = `/${raw}`;
    raw = raw.replace(/\/{2,}/g, '/');
    return raw || '/';
  };

  const extractApiKey = (req: Request): string =>
    (req.header(HEADER_NAME) ?? '').trim();

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') return next();

    const path = normalizePath(req);
    if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return next();

    const expectedApiKey =
      (config.get<string>('WEEHAWK_API_KEY') ??
        config.get<string>('GROOT_API_KEY') ??
        config.get<string>('groot.apiKey') ??
        '')
        .trim();
    const apiKey = extractApiKey(req);

    if (!expectedApiKey || !apiKey || !apiKeyMatches(apiKey, expectedApiKey)) {
      res.status(403);
      res.setHeader('Content-Type', 'application/json');
      res.send(FORBIDDEN_JSON);
      return;
    }

    next();
  };
}

