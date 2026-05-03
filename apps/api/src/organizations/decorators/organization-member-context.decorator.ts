import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { OrganizationMemberContext } from '../organizations.service';
import { ORGANIZATION_CONTEXT_KEY } from '../organization-request.constants';

/** Populated by OrgMembershipGuard after membership checks. */
export const OrgMemberContextParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationMemberContext => {
    const req = ctx.switchToHttp().getRequest<{
      [ORGANIZATION_CONTEXT_KEY]?: OrganizationMemberContext;
    }>();
    const organization = req[ORGANIZATION_CONTEXT_KEY];
    if (!organization) {
      throw new InternalServerErrorException('Organization member context missing');
    }
    return organization;
  },
);
