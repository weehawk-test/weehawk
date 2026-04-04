import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { cleanEnv } from '../../config/env-string.util';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const clientID =
      cleanEnv(process.env.GOOGLE_CLIENT_ID) ||
      cleanEnv(this.config.get<string>('google.clientId'));
    const clientSecret =
      cleanEnv(process.env.GOOGLE_CLIENT_SECRET) ||
      cleanEnv(this.config.get<string>('google.clientSecret'));
    if (
      !clientID ||
      !clientSecret ||
      clientID === 'MISSING_GOOGLE_CLIENT_ID' ||
      clientSecret === 'MISSING_GOOGLE_CLIENT_SECRET'
    ) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    return super.canActivate(context);
  }
}
