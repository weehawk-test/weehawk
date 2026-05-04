import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraefikSettings } from './entities/traefik-settings.entity';
import { TraefikController } from './traefik.controller';
import { TraefikService } from './traefik.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TraefikSettings]),
    OrganizationsModule,
    OrgRealtimeModule,
  ],
  controllers: [TraefikController],
  providers: [TraefikService],
  exports: [TraefikService],
})
export class TraefikModule {}
