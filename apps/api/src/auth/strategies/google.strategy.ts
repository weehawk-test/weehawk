import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly config: ConfigService) {
    const clientID = (config.get<string>('google.clientId') ?? '').trim();
    const clientSecret = (
      config.get<string>('google.clientSecret') ?? ''
    ).trim();
    const callbackURL = (config.get<string>('google.callbackUrl') ?? '').trim();
    const env = (
      config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      ''
    ).toLowerCase();
    if (env === 'production' && !callbackURL) {
      throw new Error('Missing google.callbackUrl in production');
    }

    super({
      // Use placeholders so the app can boot even if env is missing.
      // Requests are blocked by GoogleAuthGuard with a clear 503 error until env is set.
      clientID: clientID || 'MISSING_GOOGLE_CLIENT_ID',
      clientSecret: clientSecret || 'MISSING_GOOGLE_CLIENT_SECRET',
      callbackURL:
        callbackURL || 'http://localhost:8080/oauth2/callback/google',
      scope: ['email', 'profile'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile) {
    return profile;
  }
}
