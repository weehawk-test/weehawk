import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraefikSettings } from './entities/traefik-settings.entity';
import { TraefikController } from './traefik.controller';
import { TraefikService } from './traefik.service';

@Module({
  imports: [TypeOrmModule.forFeature([TraefikSettings])],
  controllers: [TraefikController],
  providers: [TraefikService],
  exports: [TraefikService],
})
export class TraefikModule {}
