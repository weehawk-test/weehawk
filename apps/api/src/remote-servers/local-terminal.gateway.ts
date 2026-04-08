import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'ws';
import type { WebSocket } from 'ws';
import * as pty from 'node-pty';

@WebSocketGateway({
  path: '/ws/local-terminal',
  cors: { origin: true },
})
export class LocalTerminalGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  async handleConnection(client: WebSocket) {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    let term: pty.IPty;
    try {
      term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      client.send(JSON.stringify({ type: 'error', message: msg }));
      client.close(4002, 'local terminal failed');
      return;
    }

    term.onData((data) => {
      if (client.readyState === 1) {
        client.send(Buffer.from(data, 'utf8'), { binary: true });
      }
    });

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
          const j = JSON.parse(trimmed) as { type?: string; cols?: number; rows?: number };
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
          /* not JSON control packet */
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
