import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { EmailConfirmationService } from '../email/email-confirmation.service';
import { PasswordResetService } from '../email/password-reset.service';
import { Public } from './decorators/public.decorator';

@ApiTags('Auth')
@Controller('/api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Post('/register')
  @Public()
  @Throttle({
    default: {
      limit: 5,
      ttl: 15 * 60 * 1000,
      blockDuration: 15 * 60 * 1000,
    },
  })
  @ApiBody({ type: RegisterDto })
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('/login')
  @Public()
  @Throttle({
    default: {
      limit: 5,
      ttl: 15 * 60 * 1000,
      blockDuration: 15 * 60 * 1000,
    },
  })
  @ApiBody({ type: LoginDto })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Post('/refresh')
  @Public()
  @ApiBody({ type: RefreshTokenDto })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('/logout')
  @ApiBody({ type: RefreshTokenDto })
  async logout(@Body() dto: RefreshTokenDto, @Req() req: any): Promise<{ message: string }> {
    await this.authService.logout(req.user?.email, dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @Post('/change-password')
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any): Promise<{ message: string }> {
    await this.authService.changePassword(req.user?.email, dto);
    return { message: 'Password changed successfully' };
  }

  @Get('/confirm-email')
  @Public()
  async confirmEmail(@Query('token') token: string): Promise<{ message: string }> {
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
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<{ message: string }> {
    const email = body?.email?.trim();
    if (email) {
      try {
        await this.passwordResetService.sendResetPasswordEmail(email);
      } catch {
        // Same message to avoid email enumeration
      }
    }
    return { message: 'Reset password email sent!' };
  }

  @Post('/reset-password')
  @Public()
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.passwordResetService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successfully!' };
  }
}
