import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Profile } from 'passport-google-oauth20';
import { AuthService } from './auth.service';
import { setAuthCookies } from './auth-cookies.util';
import { cleanEnv } from '../config/env-string.util';
import { Public } from './decorators/public.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';

@Controller()
export class Oauth2Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Shows the redirect_uri and client id prefix the API will use — compare with Google Cloud Console.
   * Open while the API is running: GET /api/oauth2/diagnostics
   */
  @Get(['/oauth2/diagnostics', '/api/oauth2/diagnostics'])
  @Public()
  oauthDiagnostics(): {
    redirectUri: string;
    clientIdPrefix: string;
    clientIdLength: number;
  } {
    const redirectUri =
      cleanEnv(process.env.GOOGLE_CALLBACK_URL) ||
      cleanEnv(this.config.get<string>('google.callbackUrl')) ||
      'http://localhost:8080/login/oauth2/code/google';
    const clientId =
      cleanEnv(process.env.GOOGLE_CLIENT_ID) ||
      cleanEnv(this.config.get<string>('google.clientId')) ||
      '';
    const clientIdPrefix =
      clientId.length > 16
        ? `${clientId.slice(0, 12)}…${clientId.slice(-8)}`
        : clientId || '(empty)';
    return {
      redirectUri,
      clientIdPrefix,
      clientIdLength: clientId.length,
    };
  }

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
   * We create/login user, then redirect to web frontend /auth/callback with query params
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
    const frontendBase = this.config
      .get<string>('WEBFRONTEND_BASE_URL', 'http://localhost:3000')
      .replace(/\/$/, '');
    try {
      const profile = req.user;
      if (!profile) {
        return res.redirect(
          `${frontendBase}/?oauth_error=${encodeURIComponent('Google sign-in did not return a profile.')}`,
        );
      }

      const auth = await this.authService.loginWithGoogle(profile);
      setAuthCookies(res, auth);
      return res.redirect(`${frontendBase}/auth/callback`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'OAuth failed';
      return res.redirect(
        `${frontendBase}/?oauth_error=${encodeURIComponent(msg)}`,
      );
    }
  }
}
