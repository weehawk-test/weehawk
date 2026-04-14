import type { Response } from 'express';
import type { AuthResponseDto } from './dto/auth-response.dto';

export const AUTH_ACCESS_COOKIE = 'weehawk_access_token';
export const AUTH_REFRESH_COOKIE = 'weehawk_refresh_token';

/** ~7 days — align with refresh token lifetime */
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(secure: boolean): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
} {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/' };
}

export function attachAuthCookies(res: Response, auth: AuthResponseDto, secure: boolean): void {
  const base = cookieOptions(secure);
  res.cookie(AUTH_ACCESS_COOKIE, auth.accessToken, { ...base, maxAge: REFRESH_MAX_AGE_MS });
  res.cookie(AUTH_REFRESH_COOKIE, auth.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE_MS });
}

export function clearAuthCookies(res: Response, secure: boolean): void {
  const base = cookieOptions(secure);
  res.clearCookie(AUTH_ACCESS_COOKIE, base);
  res.clearCookie(AUTH_REFRESH_COOKIE, base);
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader?.trim()) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
