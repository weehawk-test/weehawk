import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

/** Matches payload from {@link AuthService} `generateAccessToken` (sub = email). */
export interface JwtPayload {
  sub: string;
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    const fromCookie = (req: { headers?: { cookie?: string } }) => {
      const raw = req?.headers?.cookie ?? '';
      if (!raw) return null;
      const parts = raw.split(';').map((p) => p.trim());
      for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const key = part.slice(0, idx);
        if (key !== 'weehawk_at') continue;
        const value = part.slice(idx + 1);
        return decodeURIComponent(value || '');
      }
      return null;
    };
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie as never,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'change-me-in-production'),
    });
  }

  async validate(payload: JwtPayload): Promise<{ email: string; userId: number }> {
    const email = (payload.email ?? payload.sub)?.toLowerCase();
    if (!email) throw new UnauthorizedException();
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException();
    return { email: user.email, userId: user.id };
  }
}
