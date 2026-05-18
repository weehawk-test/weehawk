import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { Client } from 'ssh2';
import { RemoteServersService } from '../remote-servers/remote-servers.service';
import { ExecutorService } from './executor.service';
import { ServicesService } from '../services/services.service';
import { isRequestOriginAllowed } from '../common/cors-origin';
import { resolveUserIdFromWsUpgradeRequest } from '../auth/ws-upgrade-auth';
import { isDockerContainerId } from './docker-container-ref';

/**
 * Interactive shell inside the service's running container on the **deploy** host (SSH + `docker exec`).
 * Replaces the old local `node-pty` + host Docker path.
 */
@Injectable()
export class ServiceTerminalGateway {
  constructor(
    private readonly remoteServersService: RemoteServersService,
    private readonly executorService: ExecutorService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
  ) {}

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
    const serviceIdParam = String(
      url.searchParams.get('serviceId') ?? '',
    ).trim();
    if (!serviceIdParam) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'Missing or invalid serviceId.',
        }),
      );
      client.close(4000, 'invalid serviceId');
      return;
    }

    const userId = await resolveUserIdFromWsUpgradeRequest(req, this.jwtService);
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

    let serviceId: number;
    try {
      serviceId = await this.servicesService.resolveServiceIdForUser(
        serviceIdParam,
        userId,
      );
    } catch {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'Missing or invalid serviceId.',
        }),
      );
      client.close(4000, 'invalid serviceId');
      return;
    }

    const resolved = await this.executorService.getExecContainerId(serviceId);
    if ('error' in resolved) {
      client.send(JSON.stringify({ type: 'error', message: resolved.error }));
      client.close(4004, 'no container');
      return;
    }

    const cid = resolved.id.trim();
    if (!isDockerContainerId(cid)) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'Invalid container id from host.',
        }),
      );
      client.close(4005, 'bad container id');
      return;
    }

    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      client.send(
        JSON.stringify({
          type: 'error',
          message:
            'No deploy SSH server is set for this service. Configure Remote / deploy host, deploy, then try again.',
        }),
      );
      client.close(4006, 'no deploy host');
      return;
    }

    let ssh: Client | null = null;
    try {
      const ctx = await this.remoteServersService.getSshTerminalContext(
        sshIds.remoteServerId,
        userId,
      );
      ssh = new Client();
      const remoteCmd = `docker exec -i -t ${cid} env TERM=xterm-256color /bin/sh`;

      ssh
        .once('ready', () => {
          void this.remoteServersService
            .flushPendingSshHostKeyFingerprint(ctx.remoteServerId)
            .then(() => {
              ssh?.exec(
                remoteCmd,
                {
                  pty: true,
                  env: { TERM: 'xterm-256color' } as NodeJS.ProcessEnv,
                },
                (err, stream) => {
                  if (err) {
                    client.send(
                      JSON.stringify({ type: 'error', message: err.message }),
                    );
                    client.close(4002, 'docker exec failed');
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
