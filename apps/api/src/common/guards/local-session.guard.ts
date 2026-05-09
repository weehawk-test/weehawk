import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Injectable()
export class LocalSessionGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      user?: { userId: number; email: string; role?: string };
    }>();

    if (req.user?.userId && req.user?.email) return true;

    const authHeader = req.headers?.authorization;
    const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const cookieHeaderRaw = req.headers?.cookie;
    const cookieHeader = Array.isArray(cookieHeaderRaw)
      ? cookieHeaderRaw.join('; ')
      : (cookieHeaderRaw ?? '');
    const cookieToken = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('weehawk_access_token='))
      ?.slice('weehawk_access_token='.length);
    const tokenFromCookie = cookieToken
      ? decodeURIComponent(cookieToken).trim()
      : '';
    const token =
      bearer?.startsWith('Bearer ') && bearer.slice(7).trim()
        ? bearer.slice(7).trim()
        : tokenFromCookie;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const secret =
      this.configService.get<string>('auth.jwtSecret')?.trim() ||
      this.configService.get<string>('JWT_SECRET')?.trim();
    if (!secret) {
      throw new UnauthorizedException(
        'JWT secret is not configured (auth.jwtSecret/JWT_SECRET)',
      );
    }
    let decodedEmail = '';
    let decodedUserId = 0;
    try {
      const payload = new JwtService({ secret }).verify<{
        email?: string;
        sub?: string | number;
        userId?: number;
      }>(token);
      decodedEmail = (payload?.email ?? '').trim().toLowerCase();
      decodedUserId = Number(payload?.userId ?? payload?.sub ?? 0);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!decodedEmail || !decodedUserId)
      throw new UnauthorizedException('Invalid token payload');
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: decodedUserId } });
    if (!user || !user.enabled)
      throw new UnauthorizedException('User is disabled or missing');
    if (user.email.trim().toLowerCase() !== decodedEmail) {
      throw new UnauthorizedException('Invalid token payload');
    }
    req.user = { userId: user.id, email: user.email, role: user.role };
    return true;
  }
}
