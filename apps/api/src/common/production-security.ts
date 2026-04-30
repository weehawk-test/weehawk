import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const WEAK_JWT_SECRETS = new Set(
  [
    'change-me-in-production',
    'changeme',
    'secret',
    'jwt-secret',
    'your-secret-key',
  ].map((s) => s.toLowerCase()),
);

const WEAK_REFRESH_TOKEN_HASH_SECRETS = new Set(
  [
    'change-me',
    'changeme',
    'secret',
    'refresh-token-secret',
    'refresh-token-hash-secret',
    'token-secret',
    'jwt-secret',
    'password',
    '123456',
  ].map((s) => s.toLowerCase()),
);

/**
 * Fails fast in production when critical secrets are missing or obviously weak.
 * Call after `ConfigModule` has loaded env / docker secrets.
 */
export function assertProductionSecurityConfig(config: ConfigService): void {
  const env = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '').toLowerCase();
  if (env !== 'production') {
    return;
  }

  const log = new Logger('ProductionSecurity');
  const jwt =
    (config.get<string>('auth.jwtSecret') ??
      config.get<string>('JWT_SECRET') ??
      '').trim();
  if (!jwt || jwt.length < 32 || WEAK_JWT_SECRETS.has(jwt.toLowerCase())) {
    log.error(
      'Refusing to start: set auth.jwtSecret (or JWT_SECRET) to a random string of at least 32 characters in production.',
    );
    process.exit(1);
  }

  const enc = (config.get<string>('WEEHAWK_ENCRYPTION_KEY') ?? '').trim();
  if (!enc || enc.length < 16) {
    log.error(
      'Refusing to start: set WEEHAWK_ENCRYPTION_KEY to a long random value in production (at least 16 characters;32+ recommended).',
    );
    process.exit(1);
  }

  const refreshHashSecret = (config.get<string>('REFRESH_TOKEN_HASH_SECRET') ?? '').trim();
  if (
    !refreshHashSecret ||
    refreshHashSecret.length < 32 ||
    WEAK_REFRESH_TOKEN_HASH_SECRETS.has(refreshHashSecret.toLowerCase())
  ) {
    log.error(
      'Refusing to start: set REFRESH_TOKEN_HASH_SECRET to a random string of at least 32 characters in production.',
    );
    process.exit(1);
  }

  if (!config.get<string>('CORS_ORIGIN')?.trim()) {
    log.warn(
      'CORS_ORIGIN is unset — browsers on a different origin cannot use the API or terminal WebSockets. Set comma-separated allowed origins.',
    );
  }
}
