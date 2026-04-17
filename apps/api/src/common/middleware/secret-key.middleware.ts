import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { AUTH_ACCESS_COOKIE } from '../../auth/auth-cookies';

/**
 * Global internal API-key gate.
 * - Public/auth routes are excluded.
 * - Requests with `Authorization: Bearer <jwt>` are allowed (JWT guards validate later).
 * - Other requests must provide `X-Weehawk-Api-Key`.
 */
export function createSecretKeyMiddleware(config: ConfigService) {
  const HEADER_NAME = 'X-Weehawk-Api-Key';
  const AUTH_HEADER = 'authorization';
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
    '/hooks/', // public webhook trigger endpoint
    '/api/user/confirm-email-change',
    // GitHub App setup: GitHub servers GET the manifest (no API key); webhooks POST with signature only.
    '/api/git/github/manifest',
    '/api/git/github/webhook',
  ];

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

  const hasBearerJwtShape = (req: Request): boolean => {
    const raw = (req.header(AUTH_HEADER) ?? '').trim();
    const m = /^Bearer\s+(.+)$/i.exec(raw);
    if (!m) return false;
    const token = m[1].trim();
    return token.split('.').length === 3;
  };

  const hasAccessCookieJwtShape = (req: Request): boolean => {
    const cookieHeader = (req.headers?.cookie ?? '').trim();
    if (!cookieHeader) return false;
    const prefix = `${AUTH_ACCESS_COOKIE}=`;
    const part = cookieHeader
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(prefix));
    if (!part) return false;
    let token = part.slice(prefix.length).trim();
    try {
      token = decodeURIComponent(token);
    } catch {
      /* keep raw */
    }
    return token.split('.').length === 3;
  };

  const extractApiKey = (req: Request): string =>
    (req.header(HEADER_NAME) ?? '').trim();

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') return next();

    const path = normalizePath(req);
    if (path.includes('/oauth2/')) return next();
    if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return next();
    if (hasBearerJwtShape(req) || hasAccessCookieJwtShape(req)) return next();

    const expectedApiKey =
      (config.get<string>('WEEHAWK_API_KEY') ??
        config.get<string>('GROOT_API_KEY') ??
        config.get<string>('groot.apiKey') ??
        '')
        .trim();
    const apiKey = extractApiKey(req);

    if (!expectedApiKey || !apiKey || apiKey !== expectedApiKey) {
      res.status(403);
      res.setHeader('Content-Type', 'application/json');
      res.send(FORBIDDEN_JSON);
      return;
    }

    next();
  };
}

