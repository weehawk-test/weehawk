import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrgRealtimeGateway } from './org-realtime.gateway';
import { OrgRealtimeEmitter } from './org-realtime-emitter.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  providers: [OrgRealtimeGateway, OrgRealtimeEmitter],
  exports: [OrgRealtimeEmitter],
})
export class OrgRealtimeModule {}
