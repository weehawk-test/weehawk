import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationsService } from '../organizations.service';
import {
  ORGANIZATION_CONTEXT_KEY,
  ORG_PUBLIC_ID_PARAM_METADATA,
} from '../organization-request.constants';

@Injectable()
export class OrgMembershipGuard implements CanActivate {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      user?: { userId?: number };
      [ORGANIZATION_CONTEXT_KEY]?: unknown;
    }>();
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException('User context missing');

    const paramName =
      this.reflector.getAllAndOverride<string>(ORG_PUBLIC_ID_PARAM_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'publicId';

    const raw = req.params?.[paramName];
    const memberCtx = await this.organizationsService.requireMemberContext(
      raw,
      userId,
    );
    req[ORGANIZATION_CONTEXT_KEY] = memberCtx;
    return true;
  }
}
