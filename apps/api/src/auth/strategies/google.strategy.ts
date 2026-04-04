import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { cleanEnv } from '../../config/env-string.util';

const DEFAULT_CALLBACK =
  'http://localhost:8080/login/oauth2/code/google';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly config: ConfigService) {
    const clientID =
      cleanEnv(process.env.GOOGLE_CLIENT_ID) ||
      cleanEnv(config.get<string>('google.clientId'));
    const clientSecret =
      cleanEnv(process.env.GOOGLE_CLIENT_SECRET) ||
      cleanEnv(config.get<string>('google.clientSecret'));
    const callbackURL =
      cleanEnv(process.env.GOOGLE_CALLBACK_URL) ||
      cleanEnv(config.get<string>('google.callbackUrl')) ||
      DEFAULT_CALLBACK;

    super({
      // Use placeholders so the app can boot even if env is missing.
      // Requests are blocked by GoogleAuthGuard with a clear 503 error until env is set.
      clientID: clientID || 'MISSING_GOOGLE_CLIENT_ID',
      clientSecret: clientSecret || 'MISSING_GOOGLE_CLIENT_SECRET',
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile) {
    return profile;
  }
}
