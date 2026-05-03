import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraefikSettings } from './entities/traefik-settings.entity';
import { TraefikController } from './traefik.controller';
import { TraefikService } from './traefik.service';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TraefikSettings]),
    OrganizationsModule,
  ],
  controllers: [TraefikController],
  providers: [TraefikService],
  exports: [TraefikService],
})
export class TraefikModule {}
