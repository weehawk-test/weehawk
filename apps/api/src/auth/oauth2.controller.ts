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
import type { Request, Response } from 'express';
import type { Profile } from 'passport-google-oauth20';
import {
  attachAuthCookies,
  attachGoogleOauthLinkCookie,
  clearGoogleOauthLinkCookie,
  GOOGLE_OAUTH_LINK_COOKIE,
  parseCookieHeader,
} from './auth-cookies';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

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

  private frontendBase(): string {
    return this.config.get<string>('WEBFRONTEND_BASE_URL', 'http://localhost:3000').replace(/\/$/, '');
  }

  private isSecureCookie(): boolean {
    return (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '').toLowerCase() ===
      'production';
  }

  /**
   * Starts Google OAuth in "link to current account" mode (requires JWT session cookie).
   * Sets a short-lived cookie, then redirects to the normal Google authorize URL.
   */
  @Get(['/oauth2/google-link/start', '/api/oauth2/google-link/start'])
  @UseGuards(JwtAuthGuard)
  async startGoogleLink(
    @Req() req: Request & { user?: { userId: number } },
    @Res() res: Response,
  ): Promise<void> {
    const base = this.frontendBase();
    const userId = req.user?.userId;
    if (userId == null) {
      res.redirect(`${base}/login?${new URLSearchParams({ error: 'Sign in required to link Google.' }).toString()}`);
      return;
    }
    try {
      await this.authService.assertCanStartGoogleLink(userId);
    } catch (e) {
      const qp = new URLSearchParams({ error: oauthRedirectErrorMessage(e) });
      res.redirect(`${base}/profile?${qp.toString()}`);
      return;
    }
    const token = this.authService.createGoogleLinkIntentToken(userId);
    attachGoogleOauthLinkCookie(res, token, this.isSecureCookie());
    res.redirect(302, '/api/oauth2/authorize/google');
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
  async googleCallback(@Req() req: Request & { user?: Profile }, @Res() res: Response) {
    const frontendBase = this.frontendBase();
    const secure = this.isSecureCookie();
    let oauthLinkIntent = false;
    try {
      const profile = req.user;
      if (!profile) {
        clearGoogleOauthLinkCookie(res, secure);
        return res.redirect(`${frontendBase}/login`);
      }

      const cookies = parseCookieHeader(
        typeof req.headers?.cookie === 'string' ? req.headers.cookie : undefined,
      );
      const linkToken = cookies[GOOGLE_OAUTH_LINK_COOKIE];
      oauthLinkIntent = Boolean(linkToken);
      clearGoogleOauthLinkCookie(res, secure);

      const auth = linkToken
        ? await (async () => {
            const userId = this.authService.verifyGoogleLinkIntentToken(linkToken);
            return this.authService.linkGoogleAccount(userId, profile);
          })()
        : await this.authService.loginWithGoogle(profile);
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
      const returnPath = oauthLinkIntent ? '/profile' : '/login';
      return res.redirect(`${frontendBase}${returnPath}?${qp.toString()}`);
    }
  }
}

