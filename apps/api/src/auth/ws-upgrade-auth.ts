import type { IncomingMessage } from 'http';
import { URL } from 'url';
import type { JwtService } from '@nestjs/jwt';
import { AUTH_ACCESS_COOKIE, parseCookieHeader } from './auth-cookies';

/** Claim on JWT issued by POST /api/auth/websocket-ticket (not a session access token). */
export const WS_TERMINAL_TICKET_PURPOSE = 'ws_terminal' as const;

/**
 * Resolve the acting user for raw `ws` upgrades: optional `ticket` query (short-lived handoff JWT),
 * then httpOnly access cookie. Browsers often omit `SameSite=Lax` cookies on cross-site WebSocket
 * handshakes even when `fetch` with credentials still works.
 */
export async function resolveUserIdFromWsUpgradeRequest(
  req: IncomingMessage | undefined,
  jwtService: JwtService,
): Promise<number | null> {
  const pathAndQuery = req?.url ?? '/';
  const host = req?.headers?.host ?? 'localhost';
  let url: URL;
  try {
    url = new URL(pathAndQuery, `http://${host}`);
  } catch {
    return null;
  }

  const ticket = url.searchParams.get('ticket')?.trim();
  if (ticket) {
    try {
      const payload = await jwtService.verifyAsync<{
        purpose?: string;
        userId?: number;
        sub?: string;
      }>(ticket);
      if (payload.purpose !== WS_TERMINAL_TICKET_PURPOSE) {
        return null;
      }
      if (
        typeof payload.userId === 'number' &&
        Number.isFinite(payload.userId) &&
        payload.userId >= 1
      ) {
        return payload.userId;
      }
      const sub =
        payload.sub != null ? Number.parseInt(String(payload.sub), 10) : NaN;
      if (Number.isFinite(sub) && sub >= 1) return sub;
    } catch {
      /* try cookie */
    }
  }

  const raw = req?.headers?.cookie;
  const cookies = parseCookieHeader(typeof raw === 'string' ? raw : undefined);
  const token = cookies[AUTH_ACCESS_COOKIE]?.trim();
  if (!token) return null;
  try {
    const payload = await jwtService.verifyAsync<{
      userId?: number;
      sub?: string;
    }>(token);
    if (
      typeof payload.userId === 'number' &&
      Number.isFinite(payload.userId) &&
      payload.userId >= 1
    ) {
      return payload.userId;
    }
    const sub =
      payload.sub != null ? Number.parseInt(String(payload.sub), 10) : NaN;
    if (Number.isFinite(sub) && sub >= 1) return sub;
    return null;
  } catch {
    return null;
  }
}
