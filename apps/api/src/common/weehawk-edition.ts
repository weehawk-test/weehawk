/** Single-edition build: cloud checks are disabled. */
export function isCloudEdition(_configService?: unknown): boolean {
  return false;
}

/** Single-edition build: cloud checks are disabled. */
export function isCloudEditionFromProcessEnv(): boolean {
  return false;
}

/** User-facing copy for guards, middleware, and service-layer checks. */
export const LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE =
  'Local Docker access is enabled.';

/** Backward-compatible no-op for desktop-only mode. */
export function assertLocalHostDockerAllowed(_configService?: unknown): void {
  return;
}
