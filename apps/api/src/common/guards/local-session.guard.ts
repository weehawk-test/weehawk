import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class LocalSessionGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      user?: { userId: number; email: string };
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
    const tokenFromCookie = cookieToken ? decodeURIComponent(cookieToken).trim() : '';
    const token =
      bearer?.startsWith('Bearer ') && bearer.slice(7).trim()
        ? bearer.slice(7).trim()
        : tokenFromCookie;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const secret = this.configService.get<string>('auth.jwtSecret', 'change-me-in-production');
    let decodedEmail = '';
    let decodedUserId = 0;
    try {
      const payload = new JwtService({ secret }).verify<{ email?: string; sub?: string | number; userId?: number }>(token);
      decodedEmail = (payload?.email ?? '').trim().toLowerCase();
      decodedUserId = Number(payload?.userId ?? payload?.sub ?? 0);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!decodedEmail || !decodedUserId) throw new UnauthorizedException('Invalid token payload');
    req.user = { userId: decodedUserId, email: decodedEmail };
    return true;
  }
}
