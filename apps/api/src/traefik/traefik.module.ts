import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TraefikSettings } from './entities/traefik-settings.entity';
import { TraefikController } from './traefik.controller';
import { TraefikService } from './traefik.service';

@Module({
  imports: [TypeOrmModule.forFeature([TraefikSettings]), AuthModule],
  controllers: [TraefikController],
  providers: [TraefikService],
  exports: [TraefikService],
})
export class TraefikModule {}
