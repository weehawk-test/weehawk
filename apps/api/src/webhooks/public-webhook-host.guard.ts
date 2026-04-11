import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isPublicHooksTriggerPath,
  isPublicWebhookHostAllowed,
} from './hooks-public-host';

/**
 * Blocks {@code GET|POST /hooks/:token} unless {@code Host} contains {@code weehawk-webhook}
 * (e.g. magic {@code *.traefik.me} on the API alone no longer triggers), **or** the path is
 * {@code /hooks/{64-hex}} (token authenticates the request — same as UI redeploy via API origin).
 * Opt out: {@code WEEHAWK_HOOK_ALLOW_ANY_HOST=1}.
 */
@Injectable()
export class PublicWebhookHostGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const allowAny = this.allowAnyHost();
    const req = context.switchToHttp().getRequest<{
      headers?: { host?: string };
      path?: string;
      url?: string;
    }>();
    const pathname = req.path ?? req.url?.split('?')[0] ?? '';
    if (isPublicHooksTriggerPath(pathname)) {
      return true;
    }
    const host = req.headers?.host;
    if (
      isPublicWebhookHostAllowed(host, {
        allowAnyHost: allowAny,
        allowLoopback: true,
      })
    ) {
      return true;
    }
    throw new ForbiddenException(
      'Webhook triggers require a Host containing "weehawk-webhook" (e.g. weehawk-webhook.example.com), ' +
        'or call POST/GET /hooks/{64-hex-token} with the correct path. ' +
        'Set WEEHAWK_HOOK_ALLOW_ANY_HOST=1 on the API to allow any Host.',
    );
  }

  private allowAnyHost(): boolean {
    const v = this.config
      .get<string>('WEEHAWK_HOOK_ALLOW_ANY_HOST')
      ?.trim()
      .toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
}
