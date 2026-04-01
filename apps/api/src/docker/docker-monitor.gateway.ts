import {
  WebSocketGateway,
  OnGatewayConnection,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { DockerService } from './docker.service';
import { DockerSecretsService } from '../dockersecrets/dockersecrets.service';

@WebSocketGateway({
  path: '/ws/docker-monitor',
  cors: { origin: true },
})
export class DockerMonitorGateway implements OnGatewayConnection {
  constructor(
    private readonly dockerService: DockerService,
    private readonly dockerSecretsService: DockerSecretsService,
  ) {}

  @WebSocketServer()
  server: Server;

  async handleConnection(client: WebSocket, ...args: unknown[]) {
    const req = args[0] as IncomingMessage | undefined;
    const pathAndQuery = req?.url ?? '/';
    const host = req?.headers?.host ?? 'localhost';
    const url = new URL(pathAndQuery, `http://${host}`);

    const topic = (url.searchParams.get('topic') ?? 'stats').toLowerCase();
    const allowedTopics = new Set([
      'stats',
      'overview',
      'containers.paged',
      'services.paged',
      'images.paged',
      'networks.paged',
      'volumes.paged',
      'secrets.paged',
    ]);
    if (!allowedTopics.has(topic)) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: `Unsupported topic "${topic}".`,
        }),
      );
      client.close(4000, 'invalid topic');
      return;
    }

    const intervalRaw = Number(url.searchParams.get('intervalMs') ?? '2000');
    const intervalMs = Math.min(
      10_000,
      Math.max(500, Math.floor(intervalRaw) || 2000),
    );
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get('pageSize') ?? '10') || 10),
    );
    const q = (url.searchParams.get('q') ?? '').trim();
    const includeSizes =
      (url.searchParams.get('includeSizes') ?? '').toLowerCase() === 'true';

    let disposed = false;

    const sendStats = async () => {
      if (disposed || client.readyState !== 1) return;
      try {
        const rows = await this.dockerService.getSystemStats();
        if (disposed || client.readyState !== 1) return;
        client.send(
          JSON.stringify({ type: 'stats', at: Date.now(), data: rows }),
        );
      } catch (e) {
        if (disposed || client.readyState !== 1) return;
        const msg = e instanceof Error ? e.message : String(e);
        client.send(JSON.stringify({ type: 'error', message: msg }));
      }
    };

    const sendOverview = async () => {
      if (disposed || client.readyState !== 1) return;
      try {
        const [containers, stats] = await Promise.all([
          this.dockerService.getContainers(),
          this.dockerService.getSystemStats(),
        ]);
        if (disposed || client.readyState !== 1) return;
        client.send(
          JSON.stringify({
            type: 'overview',
            at: Date.now(),
            data: { containers, stats },
          }),
        );
      } catch (e) {
        if (disposed || client.readyState !== 1) return;
        const msg = e instanceof Error ? e.message : String(e);
        client.send(JSON.stringify({ type: 'error', message: msg }));
      }
    };

    const sendPaged = async () => {
      if (disposed || client.readyState !== 1) return;
      try {
        let data: unknown;
        if (topic === 'containers.paged') {
          data = await this.dockerService.getContainersPaged(page, pageSize, q);
        } else if (topic === 'services.paged') {
          data = await this.dockerService.getServicesPaged(page, pageSize, q);
        } else if (topic === 'images.paged') {
          data = await this.dockerService.getImagesPaged(page, pageSize, q);
        } else if (topic === 'networks.paged') {
          data = await this.dockerService.getNetworksPaged(page, pageSize, q);
        } else if (topic === 'volumes.paged') {
          data = await this.dockerService.getVolumesPaged(
            page,
            pageSize,
            q,
            includeSizes,
          );
        } else if (topic === 'secrets.paged') {
          data = await this.dockerSecretsService.findAllPaged(
            page,
            pageSize,
            q,
          );
        } else {
          return;
        }
        if (disposed || client.readyState !== 1) return;
        client.send(JSON.stringify({ type: topic, at: Date.now(), data }));
      } catch (e) {
        if (disposed || client.readyState !== 1) return;
        const msg = e instanceof Error ? e.message : String(e);
        client.send(JSON.stringify({ type: 'error', message: msg }));
      }
    };

    if (topic === 'overview') await sendOverview();
    else if (topic === 'stats') await sendStats();
    else await sendPaged();
    const activeTimer = setInterval(
      () =>
        void (topic === 'overview'
          ? sendOverview()
          : topic === 'stats'
            ? sendStats()
            : sendPaged()),
      intervalMs,
    );

    client.on('close', () => {
      disposed = true;
      clearInterval(activeTimer);
    });
  }
}
