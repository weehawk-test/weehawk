import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ConfirmTokenDto } from './dto/confirm-token.dto';
import type { Response, Request } from 'express';
import { setAuthCookies } from './auth-cookies.util';
import { PasswordResetService } from '../email/password-reset.service';
import { EmailConfirmationService } from '../email/email-confirmation.service';
import { ChangeEmailService } from '../email/change-email.service';

@ApiTags('Auth')
@Controller('/api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly changeEmailService: ChangeEmailService,
  ) {}

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

  private clearAuthCookies(res: Response): void {
    const secure = process.env.NODE_ENV === 'production';
    const base = { httpOnly: true, secure, sameSite: 'lax' as const };
    res.clearCookie('weehawk_at', { ...base, path: '/' });
    res.clearCookie('weehawk_rt', { ...base, path: '/api/auth' });
  }

  @Get('/setup-status')
  async setupStatus(): Promise<{
    edition: 'cloud' | 'selfhosted';
    needsSetup: boolean;
    hasUsers: boolean;
  }> {
    return this.authService.getSetupStatus();
  }

  @Post('/register')
  @ApiBody({ type: RegisterDto })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const out = await this.authService.register(dto);
    setAuthCookies(res, out);
    return out;
  }

  @Post('/login')
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const out = await this.authService.login(dto);
    setAuthCookies(res, out);
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
    setAuthCookies(res, out);
    return out;
  }

  @Post('/forgot-password')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBody({ type: ForgotPasswordDto })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordResetService.sendResetPasswordEmail(
      dto.email.toLowerCase(),
    );
    return {
      message:
        'If an account with that email exists and can use a password reset, a link has been sent.',
    };
  }

  @Post('/reset-password')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordResetService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password has been reset. You can sign in now.' };
  }

  @Post('/confirm-email')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBody({ type: ConfirmTokenDto })
  async confirmEmail(
    @Body() dto: ConfirmTokenDto,
  ): Promise<{ message: string }> {
    await this.emailConfirmationService.confirmEmail(dto.token);
    return { message: 'Email confirmed successfully.' };
  }

  @Post('/confirm-email-change')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBody({ type: ConfirmTokenDto })
  async confirmEmailChange(
    @Body() dto: ConfirmTokenDto,
  ): Promise<{ message: string }> {
    await this.changeEmailService.confirmEmailChange(dto.token);
    return {
      message:
        'Email updated. Please sign in again on all devices (sessions were cleared).',
    };
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
