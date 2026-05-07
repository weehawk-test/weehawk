import { Injectable, Logger } from '@nestjs/common';
import { OrgRealtimeGateway } from './org-realtime.gateway';
import { RedisService } from '../common/redis/redis.service';

export type OrgDataChangedPayload = {
  entity?: string;
  action?: string;
  publicId?: string | null;
  /** Numeric row id (webhook, cron job, …) for client UI such as shared “preparing” state */
  resourceId?: number;
};

export type OrgServiceRuntimeChangedPayload = {
  servicePublicId: string;
  running: boolean;
  /** Monotonic-ish event version for client-side de-dup/out-of-order protection. */
  seq?: number;
};

@Injectable()
export class OrgRealtimeEmitter {
  private readonly logger = new Logger(OrgRealtimeEmitter.name);

  constructor(
    private readonly gateway: OrgRealtimeGateway,
    private readonly redis: RedisService,
  ) {}

  /**
   * Broadcasts to members connected to the org room. Uses internal DB ids only server-side;
   * the event body avoids leaking internal ids to clients.
   */
  notifyOrgDataChanged(
    organizationId: number,
    payload: OrgDataChangedPayload = {},
  ): void {
    if (!Number.isFinite(organizationId) || organizationId < 1) return;
    const server = this.gateway.server;
    if (!server) return;
    server.to(`org:${organizationId}`).emit('data_changed', payload);
  }

  private async nextRuntimeSeq(organizationId: number): Promise<number> {
    const key = `org:${organizationId}:runtime:seq`;
    try {
      const next = await this.redis.eval(
        'local v=redis.call("INCR", KEYS[1]); if (v == 1) then redis.call("EXPIRE", KEYS[1], 604800); end; return v;',
        [key],
        [],
      );
      const n = Number(next);
      if (Number.isFinite(n) && n >= 1) return n;
    } catch (e) {
      this.logger.warn(
        `Runtime seq fallback to timestamp: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return Date.now();
  }

  async notifyServiceRuntimeChanged(
    organizationId: number,
    payload: OrgServiceRuntimeChangedPayload,
  ): Promise<void> {
    if (!Number.isFinite(organizationId) || organizationId < 1) return;
    const servicePublicId = payload.servicePublicId?.trim();
    if (!servicePublicId) return;
    const server = this.gateway.server;
    if (!server) return;
    const seq = Number.isFinite(payload.seq)
      ? Number(payload.seq)
      : await this.nextRuntimeSeq(organizationId);
    server.to(`org:${organizationId}`).emit('service_runtime_changed', {
      servicePublicId,
      running: payload.running === true,
      seq,
    });
  }
}
