import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const rawMode = this.config.get<string>('INSTANCE_MODE') ?? 'cloud';
    const normalized = rawMode.trim().toLowerCase();
    if (normalized === 'self-hosted') {
      throw new ForbiddenException(
        'Google OAuth is disabled for self-hosted instances.',
      );
    }
    return super.canActivate(context);
  }
}
