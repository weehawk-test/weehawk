import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  attachAuthCookies,
  clearAuthCookies,
  parseCookieHeader,
  AUTH_REFRESH_COOKIE,
} from './auth-cookies';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { AuthResponseDto } from './dto/auth-response.dto';
import { AuthSessionBodyDto } from './dto/auth-session-body.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { EmailConfirmationService } from '../email/email-confirmation.service';
import { PasswordResetService } from '../email/password-reset.service';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { resolveSecureCookies } from './secure-cookies';

const IS_DEV = ['development', 'dev'].includes(
  (process.env.NODE_ENV ?? '').toLowerCase().trim(),
);
const AUTH_THROTTLE_LIMIT = IS_DEV ? 1_000_000 : 5;
const AUTH_THROTTLE_TTL_MS = IS_DEV ? 60 * 1000 : 15 * 60 * 1000;
const AUTH_THROTTLE_BLOCK_MS = IS_DEV ? 1 : 15 * 60 * 1000;

@ApiTags('Auth')
@Controller('/api/auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly config: ConfigService,
  ) {}

  private isSecureCookie(): boolean {
    return resolveSecureCookies(this.config);
  }

  private sessionBody(auth: AuthResponseDto): AuthSessionBodyDto {
    return {
      userId: auth.userId,
      firstName: auth.firstName,
      lastName: auth.lastName,
      email: auth.email,
      role: auth.role,
      provider: auth.provider,
      imageUrl: auth.imageUrl,
      emailVerified: auth.emailVerified,
    };
  }

  private assertPasswordRecoveryAllowed(): void {
    const rawMode = this.config.get<string>('INSTANCE_MODE') ?? 'cloud';
    if (rawMode.trim().toLowerCase() === 'self-hosted') {
      throw new ForbiddenException(
        'Password recovery is disabled for self-hosted instances.',
      );
    }
  }

  @Post('/register')
  @Public()
  @Throttle({
    default: {
      limit: AUTH_THROTTLE_LIMIT,
      ttl: AUTH_THROTTLE_TTL_MS,
      blockDuration: AUTH_THROTTLE_BLOCK_MS,
    },
  })
  @ApiBody({ type: RegisterDto })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionBodyDto> {
    const auth = await this.authService.register(dto);
    attachAuthCookies(res, auth, this.isSecureCookie());
    return this.sessionBody(auth);
  }

  @Get('/status')
  @Public()
  async status(): Promise<{
    instanceMode: 'cloud' | 'self-hosted';
    userConfigured: boolean;
    registrationOpen: boolean;
  }> {
    return this.authService.getRegistrationStatus();
  }

  @Post('/login')
  @Public()
  @Throttle({
    default: {
      limit: AUTH_THROTTLE_LIMIT,
      ttl: AUTH_THROTTLE_TTL_MS,
      blockDuration: AUTH_THROTTLE_BLOCK_MS,
    },
  })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionBodyDto> {
    const auth = await this.authService.login(dto);
    attachAuthCookies(res, auth, this.isSecureCookie());
    return this.sessionBody(auth);
  }

  @Post('/refresh')
  @Public()
  @ApiBody({ type: RefreshTokenDto })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: { headers?: { cookie?: string } },
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionBodyDto> {
    const rawCookie = req.headers?.cookie;
    const cookies = parseCookieHeader(
      typeof rawCookie === 'string' ? rawCookie : undefined,
    );
    const refreshToken =
      dto.refreshToken?.trim() || cookies[AUTH_REFRESH_COOKIE];
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const auth = await this.authService.refresh(refreshToken);
    attachAuthCookies(res, auth, this.isSecureCookie());
    return this.sessionBody(auth);
  }

  @Post('/logout')
  @ApiBody({ type: RefreshTokenDto })
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: { user?: { email: string }; headers?: { cookie?: string } },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const rawCookie = req.headers?.cookie;
    const cookies = parseCookieHeader(
      typeof rawCookie === 'string' ? rawCookie : undefined,
    );
    const refreshToken =
      dto.refreshToken?.trim() || cookies[AUTH_REFRESH_COOKIE];
    if (refreshToken && req.user?.email) {
      await this.authService.logout(req.user.email, refreshToken);
    }
    clearAuthCookies(res, this.isSecureCookie());
    return { message: 'Logged out successfully' };
  }

  @Post('/change-password')
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: any,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(req.user?.email, dto);
    return { message: 'Password changed successfully' };
  }

  @Get('/confirm-email')
  @Public()
  async confirmEmail(
    @Query('token') token: string,
  ): Promise<{ message: string }> {
    await this.emailConfirmationService.confirmEmail(token);
    return { message: 'Email confirmed successfully!' };
  }

  @Post('/resend-confirmation')
  async resendConfirmation(@Req() req: any): Promise<{ message: string }> {
    await this.authService.resendConfirmation(req.user?.email);
    return { message: 'Confirmation email resent!' };
  }

  @Post('/forgot-password')
  @Public()
  @ApiBody({ type: ForgotPasswordDto })
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    this.assertPasswordRecoveryAllowed();
    const email = body?.email?.trim();
    if (email) {
      try {
        await this.passwordResetService.sendResetPasswordEmail(email);
      } catch (error) {
        const err = error as { message?: string };
        this.logger.warn(
          `FORGOT_PASSWORD_EMAIL_FAILED: email="${email}" reason="${err?.message ?? 'unknown'}"`,
        );
        // Same message to avoid email enumeration
      }
    }
    return { message: 'Reset password email sent!' };
  }

  @Post('/reset-password')
  @Public()
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    this.assertPasswordRecoveryAllowed();
    await this.passwordResetService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successfully!' };
  }

  /** Clears HttpOnly auth cookies when refresh fails or the client cannot call logout (no JWT). */
  @Post('/session/abort')
  @Public()
  sessionAbort(@Res({ passthrough: true }) res: Response): { ok: true } {
    clearAuthCookies(res, this.isSecureCookie());
    return { ok: true };
  }
}
