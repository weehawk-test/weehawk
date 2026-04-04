import type { Response } from 'express';
import type { AuthResponseDto } from './dto/auth-response.dto';

export function setAuthCookies(res: Response, payload: AuthResponseDto): void {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('weehawk_at', payload.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.cookie('weehawk_rt', payload.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
