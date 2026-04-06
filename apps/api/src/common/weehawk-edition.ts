import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Matches `WEEHAWK_EDITION` (`cloud` | `selfhosted`). */
export function isCloudEdition(configService: ConfigService): boolean {
  return (
    (configService.get<string>('WEEHAWK_EDITION') ?? 'selfhosted').toLowerCase() ===
    'cloud'
  );
}

/** Same edition check using `process.env` (e.g. HTTP middleware before Nest DI). */
export function isCloudEditionFromProcessEnv(): boolean {
  return (process.env.WEEHAWK_EDITION ?? 'selfhosted').toLowerCase() === 'cloud';
}

/** User-facing copy for guards, middleware, and service-layer checks. */
export const LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE =
  'Local Docker on the platform host is not available in Weehawk Cloud. Use a remote server over SSH (Remote Docker).';

/**
 * Throws when the API must not run Docker CLI / talk to the host daemon (`WEEHAWK_EDITION=cloud`).
 * Use in services so internal call paths cannot bypass HTTP guards.
 */
export function assertLocalHostDockerAllowed(configService: ConfigService): void {
  if (isCloudEdition(configService)) {
    throw new ForbiddenException(LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE);
  }
}
