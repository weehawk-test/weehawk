import {
  WebSocketGateway,
  OnGatewayConnection,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import * as pty from 'node-pty';
import { Client, type ClientChannel } from 'ssh2';
import { ConfigService } from '@nestjs/config';
import { ExecutorService } from '../executor/executor.service';
import { ServicesService } from './services.service';
import { RemoteServersService } from '../remote-servers/remote-servers.service';
import {
  assertLocalHostDockerAllowed,
  LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE,
} from '../common/weehawk-edition';

/** Docker container id from `docker ps` (short or full hex). */
function isSafeDockerContainerId(id: string): boolean {
  const t = id.trim();
  return /^[0-9a-f]{12,64}$/i.test(t);
}

@WebSocketGateway({
  path: '/ws/service-terminal',
  cors: { origin: true },
})
export class ServiceTerminalGateway implements OnGatewayConnection {
  constructor(
    private readonly executorService: ExecutorService,
    private readonly servicesService: ServicesService,
    private readonly remoteServersService: RemoteServersService,
    private readonly configService: ConfigService,
  ) {}

  @WebSocketServer()
  server: Server;

  async handleConnection(client: WebSocket, ...args: unknown[]) {
    try {
      assertLocalHostDockerAllowed(this.configService);
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE;
      client.send(JSON.stringify({ type: 'error', message: msg }));
      client.close(4403, 'forbidden');
      return;
    }

    const req = args[0] as IncomingMessage | undefined;
    const pathAndQuery = req?.url ?? '/';
    const host = req?.headers?.host ?? 'localhost';
    const url = new URL(pathAndQuery, `http://${host}`);
    const serviceIdRaw = url.searchParams.get('serviceId');
    const serviceId = serviceIdRaw ? parseInt(serviceIdRaw, 10) : NaN;
    if (!Number.isFinite(serviceId)) {
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
      client.close(4001, resolved.error.slice(0, 120));
      return;
    }

    const sshTargets = await this.servicesService.getDockerSshTargetIds(serviceId);
    const containerId = resolved.id.trim();

    if (!isSafeDockerContainerId(containerId)) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'Could not resolve a valid container id for this service.',
        }),
      );
      client.close(4005, 'bad container id');
      return;
    }

    if (sshTargets.remoteServerId != null) {
      this.attachRemoteDockerExec(client, sshTargets.remoteServerId, containerId);
      return;
    }

    let term: pty.IPty;
    try {
      term = pty.spawn('docker', ['exec', '-it', containerId, 'sh'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      client.send(JSON.stringify({ type: 'error', message: msg }));
      client.close(4002, msg.slice(0, 120));
      return;
    }

    const sendOut = (chunk: string) => {
      if (client.readyState === 1) {
        client.send(Buffer.from(chunk, 'utf8'), { binary: true });
      }
    };

    term.onData((data) => sendOut(data));

    term.onExit(() => {
      try {
        if (client.readyState === 1) client.close();
      } catch {
        /* ignore */
      }
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
              term.resize(cols, rows);
            } catch {
              /* ignore */
            }
            return;
          }
        } catch {
          /* not JSON — treat as terminal input */
        }
      }

      try {
        term.write(s);
      } catch {
        /* ignore */
      }
    });

    client.on('close', () => {
      try {
        term.kill();
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Runs `docker exec` on the deploy host over SSH so the browser session does not need local Docker.
   */
  private attachRemoteDockerExec(
    client: WebSocket,
    remoteServerId: number,
    containerId: string,
  ): void {
    let ssh: Client | null = null;
    client.on('close', () => {
      try {
        ssh?.end();
      } catch {
        /* ignore */
      }
    });
    try {
      void this.remoteServersService
        .getSshTerminalContext(remoteServerId)
        .then((ctx) => {
          ssh = new Client();
          ssh
            .once('ready', () => {
              const cmd = `docker exec -it ${containerId} sh`;
              ssh!.exec(
                cmd,
                {
                  pty: {
                    term: 'xterm-256color',
                    cols: 80,
                    rows: 24,
                  },
                },
                (err, stream) => {
                  if (err || !stream) {
                    const msg = err?.message ?? 'Remote docker exec failed.';
                    if (client.readyState === 1) {
                      client.send(JSON.stringify({ type: 'error', message: msg }));
                      client.close(4002, 'exec failed');
                    }
                    try {
                      ssh?.end();
                    } catch {
                      /* ignore */
                    }
                    return;
                  }
                  this.wireSshStreamToClient(client, stream, () => {
                    try {
                      ssh?.end();
                    } catch {
                      /* ignore */
                    }
                  });
                },
              );
            })
            .on('error', (e: Error) => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'error', message: e.message }));
                client.close(4001, 'ssh connection failed');
              }
            })
            .connect({
              host: ctx.connect.host,
              port: ctx.connect.port,
              username: ctx.connect.username,
              privateKey: ctx.connect.privateKey,
              readyTimeout: 120_000,
              hostVerifier: () => true,
              ...(ctx.connect.family != null ? { family: ctx.connect.family } : {}),
            });
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'error', message: msg }));
            client.close(4003, 'terminal setup failed');
          }
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'error', message: msg }));
        client.close(4003, 'terminal setup failed');
      }
    }
  }

  private wireSshStreamToClient(
    client: WebSocket,
    stream: ClientChannel,
    onStreamEnd: () => void,
  ): void {
    stream.on('data', (d: Buffer) => {
      if (client.readyState === 1) {
        client.send(d, { binary: true });
      }
    });
    stream.stderr?.on('data', (d: Buffer) => {
      if (client.readyState === 1) {
        client.send(d, { binary: true });
      }
    });
    stream.on('close', () => {
      onStreamEnd();
      try {
        if (client.readyState === 1) client.close(1000, 'terminal closed');
      } catch {
        /* ignore */
      }
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
  }
}
