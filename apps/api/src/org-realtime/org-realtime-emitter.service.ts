import { Injectable } from '@nestjs/common';
import { OrgRealtimeGateway } from './org-realtime.gateway';

export type OrgDataChangedPayload = {
  entity?: string;
  action?: string;
  publicId?: string | null;
  /** Numeric row id (webhook, cron job, …) for client UI such as shared “preparing” state */
  resourceId?: number;
};

@Injectable()
export class OrgRealtimeEmitter {
  constructor(private readonly gateway: OrgRealtimeGateway) {}

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
}
