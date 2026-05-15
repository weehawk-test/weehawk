import {
  Body,
  Controller,
  Patch,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LocalSessionGuard } from '../../common/guards/local-session.guard';
import { OrgMembershipGuard } from '../../organizations/guards/org-membership.guard';
import { OrgMemberContextParam } from '../../organizations/decorators/organization-member-context.decorator';
import type { OrganizationMemberContext } from '../../organizations/organization-member-context';
import { SetOrgMemberWorkspacePermissionsDto } from './dto/set-org-member-workspace-permissions.dto';
import { OrganizationPermissionsService } from './organization-permissions.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/organizations')
export class OrganizationPermissionsController {
  constructor(
    private readonly organizationPermissionsService: OrganizationPermissionsService,
  ) {}

  @Patch(':publicId/members/permissions')
  @UseGuards(OrgMembershipGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary:
      'Update workspace area permissions for a non-owner member (organization owners only)',
  })
  setMemberWorkspacePermissions(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Body() dto: SetOrgMemberWorkspacePermissionsDto,
  ) {
    return this.organizationPermissionsService.setMemberWorkspacePermissions(
      ctx,
      dto.email,
      dto.permissions,
    );
  }
}
