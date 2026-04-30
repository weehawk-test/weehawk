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
 * Allows public trigger path {@code /weehawk-hooks/{64-hex}} and validates host policy.
 * Opt out of host policy: {@code WEEHAWK_HOOK_ALLOW_ANY_HOST=1}.
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
    if (!isPublicHooksTriggerPath(pathname)) {
      throw new ForbiddenException('Webhook trigger path is invalid.');
    }
    const allowedHosts = this.allowedHosts();
    const host = req.headers?.host;
    if (
      isPublicWebhookHostAllowed(host, {
        allowAnyHost: allowAny,
        allowLoopback: true,
        allowedHosts,
      })
    ) {
      return true;
    }
    throw new ForbiddenException(
      'Webhook trigger blocked by host policy. ' +
        'Call POST/GET /weehawk-hooks/{64-hex-token} with the correct path, ' +
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

  private allowedHosts(): string[] {
    const out = new Set<string>();
    const pushMaybeUrl = (raw: string | undefined) => {
      const t = raw?.trim();
      if (!t) return;
      try {
        const u = new URL(t.includes('://') ? t : `https://${t}`);
        out.add(u.host);
      } catch {
        out.add(t);
      }
    };
    const cors = this.config.get<string>('CORS_ORIGIN') ?? '';
    for (const part of cors.split(',').map((v) => v.trim()).filter(Boolean)) {
      if (part === '*' || part.toLowerCase() === 'true') continue;
      pushMaybeUrl(part);
    }
    pushMaybeUrl(this.config.get<string>('WEB_ORIGIN'));
    pushMaybeUrl(this.config.get<string>('API_PUBLIC_URL'));
    return [...out];
  }
}
