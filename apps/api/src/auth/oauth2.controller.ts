import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Profile } from 'passport-google-oauth20';
import { attachAuthCookies } from './auth-cookies';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';

function oauthRedirectErrorMessage(e: unknown): string {
  if (
    e instanceof ConflictException ||
    e instanceof ForbiddenException ||
    e instanceof UnauthorizedException
  ) {
    return e.message;
  }
  return 'Sign-in could not be completed. Please try again.';
}

@Controller()
export class Oauth2Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Starts Google OAuth flow.
   * Production (Traefik): GET /api/oauth2/authorize/google — local: GET /oauth2/authorize/google
   */
  @Get(['/oauth2/authorize/google', '/api/oauth2/authorize/google'])
  @Public()
  @UseGuards(GoogleAuthGuard)
  authorizeGoogle(): void {
    // Passport redirect
  }

  /**
   * Google redirects here after auth.
   * We create/login user, then redirect to webfrontend /auth/callback with query params
   * that the Next route handler expects.
   */
  @Get([
    '/oauth2/callback/google',
    '/login/oauth2/code/google',
    '/api/oauth2/callback/google',
    '/api/login/oauth2/code/google',
  ])
  @Public()
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: { user?: Profile }, @Res() res: Response) {
    const frontendBase = this.config.get<string>('WEBFRONTEND_BASE_URL', 'http://localhost:3000').replace(/\/$/, '');
    try {
      const profile = req.user;
      if (!profile) {
        return res.redirect(`${frontendBase}/login`);
      }

      const auth = await this.authService.loginWithGoogle(profile);
      const secure =
        (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '').toLowerCase() ===
        'production';
      attachAuthCookies(res, auth, secure);
      const qp = new URLSearchParams({
        email: auth.email,
        user_id: String(auth.userId),
        first_name: auth.firstName ?? '',
        last_name: auth.lastName ?? '',
        role: String(auth.role ?? 'USER'),
        provider: String(auth.provider ?? 'GOOGLE'),
        email_verified: String(auth.emailVerified ?? true),
      });
      if (auth.imageUrl) qp.set('image_url', auth.imageUrl);

      return res.redirect(`${frontendBase}/auth/callback?${qp.toString()}`);
    } catch (e) {
      const qp = new URLSearchParams({ error: oauthRedirectErrorMessage(e) });
      return res.redirect(`${frontendBase}/login?${qp.toString()}`);
    }
  }
}

