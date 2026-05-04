import type { INestApplication } from '@nestjs/common';
import { WebSocketServer } from 'ws';
import { RemoteTerminalGateway } from './remote-servers/remote-terminal.gateway';
import { ServiceTerminalGateway } from './executor/service-terminal.gateway';

/**
 * SSH terminal gateways use the native `ws` protocol. The app-wide adapter is Socket.IO
 * for org realtime, so we attach these paths via explicit upgrade handling.
 */
export function registerRawTerminalWebSockets(app: INestApplication): void {
  const httpServer = app.getHttpServer();
  const remoteTerminal = app.get(RemoteTerminalGateway);
  const serviceTerminal = app.get(ServiceTerminalGateway);
  const wssRemote = new WebSocketServer({ noServer: true });
  const wssService = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (url.startsWith('/ws/remote-terminal')) {
      wssRemote.handleUpgrade(request, socket, head, (ws) => {
        void remoteTerminal.handleConnection(ws, request);
      });
      return;
    }
    if (url.startsWith('/ws/service-terminal')) {
      wssService.handleUpgrade(request, socket, head, (ws) => {
        void serviceTerminal.handleConnection(ws, request);
      });
    }
  });
}
