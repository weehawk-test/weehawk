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
import { ExecutorService } from './ExecutorService';

@WebSocketGateway({
  path: '/ws/service-terminal',
  cors: { origin: true },
})
export class ServiceTerminalGateway implements OnGatewayConnection {
  constructor(private readonly executorService: ExecutorService) {}

  @WebSocketServer()
  server: Server;

  async handleConnection(client: WebSocket, ...args: unknown[]) {
    const req = args[0] as IncomingMessage | undefined;
    const pathAndQuery = req?.url ?? '/';
    const host = req?.headers?.host ?? 'localhost';
    const url = new URL(pathAndQuery, `http://${host}`);
    const serviceIdRaw = url.searchParams.get('serviceId');
    const serviceId = serviceIdRaw ? parseInt(serviceIdRaw, 10) : NaN;
    if (!Number.isFinite(serviceId)) {
      client.send(JSON.stringify({ type: 'error', message: 'Missing or invalid serviceId.' }));
      client.close(4000, 'invalid serviceId');
      return;
    }

    const resolved = await this.executorService.getExecContainerId(serviceId);
    if ('error' in resolved) {
      client.send(JSON.stringify({ type: 'error', message: resolved.error }));
      client.close(4001, resolved.error.slice(0, 120));
      return;
    }

    let term: pty.IPty;
    try {
      term = pty.spawn(
        'docker',
        ['exec', '-it', resolved.id, 'sh'],
        {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
        },
      );
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
          : Buffer.from(data as ArrayBuffer);

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
            const cols = Math.min(512, Math.max(2, Math.floor(Number(j.cols)) || 80));
            const rows = Math.min(512, Math.max(2, Math.floor(Number(j.rows)) || 24));
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
}
