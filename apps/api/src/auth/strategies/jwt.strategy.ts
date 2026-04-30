import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AUTH_ACCESS_COOKIE } from '../auth-cookies';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    const jwtSecret =
      config.get<string>('auth.jwtSecret')?.trim() ||
      config.get<string>('JWT_SECRET')?.trim();
    if (!jwtSecret) {
      throw new Error('Missing auth.jwtSecret/JWT_SECRET');
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => {
          const raw = req.headers?.cookie;
          if (!raw || typeof raw !== 'string') return null;
          const part = raw
            .split(';')
            .map((p) => p.trim())
            .find((p) => p.startsWith(`${AUTH_ACCESS_COOKIE}=`));
          if (!part) return null;
          const v = part.slice(`${AUTH_ACCESS_COOKIE}=`.length).trim();
          try {
            return decodeURIComponent(v);
          } catch {
            return v;
          }
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<{ email: string; userId: number; role: string }> {
    const user = await this.userRepo.findOne({
      where: { email: payload.email },
    });
    if (!user || !user.enabled) throw new UnauthorizedException();
    return { email: user.email, userId: user.id, role: user.role };
  }
}
