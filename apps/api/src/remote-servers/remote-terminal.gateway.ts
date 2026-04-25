import {
  WebSocketGateway,
  OnGatewayConnection,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { Client } from 'ssh2';
import { resolveCorsOrigin } from '../common/cors-origin';
import { RemoteServersService } from './remote-servers.service';

@WebSocketGateway({
  path: '/ws/remote-terminal',
  cors: {
    origin: resolveCorsOrigin(process.env.CORS_ORIGIN, process.env.NODE_ENV, {
      logWarnings: false,
    }),
    credentials: true,
  },
})
export class RemoteTerminalGateway implements OnGatewayConnection {
  constructor(private readonly remoteServersService: RemoteServersService) {}

  @WebSocketServer()
  server: Server;

  async handleConnection(client: WebSocket, ...args: unknown[]) {
    const req = args[0] as IncomingMessage | undefined;
    const pathAndQuery = req?.url ?? '/';
    const host = req?.headers?.host ?? 'localhost';
    const url = new URL(pathAndQuery, `http://${host}`);
    const serverIdRaw = url.searchParams.get('serverId');
    const serverPublicId = String(serverIdRaw ?? '').trim();
    if (!serverPublicId) {
      client.send(JSON.stringify({ type: 'error', message: 'Missing or invalid serverId.' }));
      client.close(4000, 'invalid serverId');
      return;
    }

    let ssh: Client | null = null;
    try {
      const serverId =
        await this.remoteServersService.resolveServerIdByPublicId(serverPublicId);
      const ctx = await this.remoteServersService.getSshTerminalContext(serverId);
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
                    client.send(JSON.stringify({ type: 'error', message: err.message }));
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
                    if (client.readyState === 1) client.close(1000, 'terminal closed');
                  });

                  client.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
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
                  });
                },
              );
            });
        })
        .on('error', (e: Error) => {
          this.remoteServersService.clearPendingSshHostKeyForServer(ctx.remoteServerId);
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
