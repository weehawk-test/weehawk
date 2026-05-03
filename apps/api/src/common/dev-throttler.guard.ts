import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Skip Nest Throttler entirely in local dev so login/register and global limits
 * do not block iteration (Redis can otherwise keep a long block after a few tries).
 *
 * Enable skipping when:
 * - `NODE_ENV` is `development` or `dev`, or
 * - `DISABLE_THROTTLE` is `1` / `true` / `yes` / `on`
 */
export function isApiThrottlingDisabled(): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase().trim();
  if (nodeEnv === 'development' || nodeEnv === 'dev') return true;
  const flag = (process.env.DISABLE_THROTTLE ?? '').toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(flag);
}

@Injectable()
export class DevThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (isApiThrottlingDisabled()) return true;
    return super.shouldSkip(context);
  }
}
