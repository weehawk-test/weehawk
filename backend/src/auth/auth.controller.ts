import { Body, Controller, Get, Post, Res, Req } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import type { Response, Request } from 'express';

@ApiTags('Auth')
@Controller('/api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private readCookie(req: Request, key: string): string | undefined {
    const raw = req.headers.cookie ?? '';
    if (!raw) return undefined;
    const items = raw.split(';').map((p) => p.trim());
    for (const item of items) {
      const idx = item.indexOf('=');
      if (idx <= 0) continue;
      const k = item.slice(0, idx);
      if (k !== key) continue;
      return decodeURIComponent(item.slice(idx + 1) || '');
    }
    return undefined;
  }

  private setAuthCookies(res: Response, payload: AuthResponseDto): void {
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

  private clearAuthCookies(res: Response): void {
    const secure = process.env.NODE_ENV === 'production';
    const base = { httpOnly: true, secure, sameSite: 'lax' as const };
    res.clearCookie('weehawk_at', { ...base, path: '/' });
    res.clearCookie('weehawk_rt', { ...base, path: '/api/auth' });
  }

  @Get('/setup-status')
  async setupStatus(): Promise<{ needsSetup: boolean }> {
    return this.authService.getSetupStatus();
  }

  @Post('/register')
  @ApiBody({ type: RegisterDto })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const out = await this.authService.register(dto);
    this.setAuthCookies(res, out);
    return out;
  }

  @Post('/login')
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const out = await this.authService.login(dto);
    this.setAuthCookies(res, out);
    return out;
  }

  @Post('/refresh')
  @ApiBody({ type: RefreshTokenDto })
  async refresh(
    @Body() dto: Partial<RefreshTokenDto>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const refreshToken = dto.refreshToken ?? this.readCookie(req, 'weehawk_rt');
    const out = await this.authService.refresh(refreshToken ?? '');
    this.setAuthCookies(res, out);
    return out;
  }

  @Post('/logout')
  @ApiBody({ type: RefreshTokenDto })
  async logout(
    @Body() dto: Partial<RefreshTokenDto> & { email?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const refreshToken = dto.refreshToken ?? this.readCookie(req, 'weehawk_rt');
    await this.authService.logout(refreshToken ?? '', dto.email);
    this.clearAuthCookies(res);
    return { message: 'Logged out successfully' };
  }
}
