import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { Client } from 'ssh2';
import { isRequestOriginAllowed } from '../common/cors-origin';
import { RemoteServersService } from './remote-servers.service';
import { AUTH_ACCESS_COOKIE, parseCookieHeader } from '../auth/auth-cookies';

@Injectable()
export class RemoteTerminalGateway {
  constructor(
    private readonly remoteServersService: RemoteServersService,
    private readonly jwtService: JwtService,
  ) {}

  private async userIdFromWsRequest(
    req: IncomingMessage | undefined,
  ): Promise<number | null> {
    const raw = req?.headers?.cookie;
    const cookies = parseCookieHeader(
      typeof raw === 'string' ? raw : undefined,
    );
    const token = cookies[AUTH_ACCESS_COOKIE]?.trim();
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

  async handleConnection(client: WebSocket, ...args: unknown[]) {
    const req = args[0] as IncomingMessage | undefined;
    const rawOrigin = req?.headers?.origin;
    const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (
      !isRequestOriginAllowed(
        origin,
        process.env.CORS_ORIGIN,
        process.env.NODE_ENV,
      )
    ) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'WebSocket origin is not allowed.',
        }),
      );
      client.close(4008, 'origin not allowed');
      return;
    }
    const pathAndQuery = req?.url ?? '/';
    const host = req?.headers?.host ?? 'localhost';
    const url = new URL(pathAndQuery, `http://${host}`);
    const serverIdRaw = url.searchParams.get('serverId');
    const serverPublicId = String(serverIdRaw ?? '').trim();
    if (!serverPublicId) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'Missing or invalid serverId.',
        }),
      );
      client.close(4000, 'invalid serverId');
      return;
    }
    const userId = await this.userIdFromWsRequest(req);
    if (userId == null) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'Unauthorized: sign in again, then open the terminal.',
        }),
      );
      client.close(4007, 'unauthorized');
      return;
    }

    let ssh: Client | null = null;
    try {
      const serverId = await this.remoteServersService.resolveServerIdForUser(
        serverPublicId,
        userId,
      );
      const ctx =
        await this.remoteServersService.getSshTerminalContext(serverId, userId);
      ssh = new Client();
      ssh
        .once('ready', () => {
          void this.remoteServersService
            .flushPendingSshHostKeyFingerprint(ctx.remoteServerId)
            .then(() => {
              ssh?.shell(
                { term: 'xterm-256color', cols: 80, rows: 24 },
                (err, stream) => {
                  if (err) {
                    client.send(
                      JSON.stringify({ type: 'error', message: err.message }),
                    );
                    client.close(4002, 'ssh shell failed');
                    return;
                  }

                  stream.on('data', (d: Buffer) => {
                    if (client.readyState === 1) {
                      client.send(d, { binary: true });
                    }
                  });
                  stream.stderr.on('data', (d: Buffer) => {
                    if (client.readyState === 1) {
                      client.send(d, { binary: true });
                    }
                  });
                  stream.on('close', () => {
                    try {
                      ssh?.end();
                    } catch {
                      /* ignore */
                    }
                    if (client.readyState === 1)
                      client.close(1000, 'terminal closed');
                  });

                  client.on(
                    'message',
                    (data: Buffer | ArrayBuffer | Buffer[]) => {
                      const buf = Array.isArray(data)
                        ? Buffer.concat(data)
                        : Buffer.isBuffer(data)
                          ? data
                          : Buffer.from(data);
                      const s = buf.toString('utf8');
                      const trimmed = s.trim();
                      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                        try {
                          const j = JSON.parse(trimmed) as {
                            type?: string;
                            cols?: number;
                            rows?: number;
                          };
                          if (j.type === 'resize') {
                            const cols = Math.min(
                              512,
                              Math.max(2, Math.floor(Number(j.cols)) || 80),
                            );
                            const rows = Math.min(
                              512,
                              Math.max(2, Math.floor(Number(j.rows)) || 24),
                            );
                            try {
                              stream.setWindow(rows, cols, 0, 0);
                            } catch {
                              /* ignore */
                            }
                            return;
                          }
                        } catch {
                          /* not JSON control packet */
                        }
                      }
                      try {
                        stream.write(s);
                      } catch {
                        /* ignore */
                      }
                    },
                  );
                },
              );
            });
        })
        .on('error', (e: Error) => {
          this.remoteServersService.clearPendingSshHostKeyForServer(
            ctx.remoteServerId,
          );
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'error', message: e.message }));
            client.close(4001, 'ssh connection failed');
          }
        })
        .connect(ctx.connect);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      client.send(JSON.stringify({ type: 'error', message: msg }));
      client.close(4003, 'terminal setup failed');
      return;
    }

    client.on('close', () => {
      try {
        ssh?.end();
      } catch {
        /* ignore */
      }
    });
  }
}
