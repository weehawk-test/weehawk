import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import {
  isRequestOriginAllowed,
  resolveCorsOrigin,
} from '../common/cors-origin';
import { AUTH_ACCESS_COOKIE, parseCookieHeader } from '../auth/auth-cookies';
import { OrganizationsService } from '../organizations/organizations.service';

@WebSocketGateway({
  namespace: '/org-realtime',
  cors: {
    origin: resolveCorsOrigin(process.env.CORS_ORIGIN, process.env.NODE_ENV, {
      logWarnings: false,
    }),
    credentials: true,
  },
})
export class OrgRealtimeGateway implements OnGatewayConnection {
  constructor(
    private readonly jwtService: JwtService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  @WebSocketServer()
  server!: Server;

  private cookieHeader(socket: Socket): string | undefined {
    const raw = socket.handshake.headers.cookie;
    if (raw == null) return undefined;
    if (Array.isArray(raw)) return raw.join('; ');
    return String(raw);
  }

  private async userIdFromSocket(socket: Socket): Promise<number | null> {
    const cookies = parseCookieHeader(this.cookieHeader(socket));
    let token: string | undefined = cookies[AUTH_ACCESS_COOKIE]?.trim();
    if (!token) {
      const auth = socket.handshake.auth as { accessToken?: unknown } | undefined;
      const fromAuth =
        typeof auth?.accessToken === 'string' ? auth.accessToken.trim() : '';
      token = fromAuth.length > 0 ? fromAuth : undefined;
    }
    if (!token) return null;
    try {
      const payload = await this.jwtService.verifyAsync<{
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

  async handleConnection(client: Socket): Promise<void> {
    const rawOrigin = client.handshake.headers.origin;
    const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (
      !isRequestOriginAllowed(
        origin,
        process.env.CORS_ORIGIN,
        process.env.NODE_ENV,
      )
    ) {
      client.disconnect(true);
      return;
    }

    const userId = await this.userIdFromSocket(client);
    if (userId == null) {
      client.disconnect(true);
      return;
    }

    const auth = client.handshake.auth as
      | { organizationPublicId?: unknown }
      | undefined;
    const q = client.handshake.query.organizationPublicId;
    const rawOrg =
      (typeof auth?.organizationPublicId === 'string'
        ? auth.organizationPublicId
        : undefined) ??
      (typeof q === 'string' ? q : Array.isArray(q) ? q[0] : undefined);

    try {
      const ctx = await this.organizationsService.requireMemberContext(
        rawOrg,
        userId,
      );
      await client.join(`org:${ctx.internalId}`);
    } catch {
      client.disconnect(true);
    }
  }
}
