import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { OrganizationsService } from './organizations.service';
import type { OrganizationMemberContext } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { AcceptOrganizationInviteDto } from './dto/accept-organization-invite.dto';
import { OrgMembershipGuard } from './guards/org-membership.guard';
import { OrgMemberContextParam } from './decorators/organization-member-context.decorator';
import { OrganizationInviteService } from './organization-invite.service';
import { SetOrganizationMemberRoleDto } from './dto/set-organization-member-role.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { SetOrgMemberWorkspacePermissionsDto } from './dto/set-org-member-workspace-permissions.dto';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly organizationInviteService: OrganizationInviteService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Post()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({ summary: 'Create organization (you become owner and member)' })
  create(
    @Body() dto: CreateOrganizationDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationsService.create(this.uid(req), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List organizations you belong to' })
  list(@Req() req: { user?: { userId: number } }) {
    return this.organizationsService.listMine(this.uid(req));
  }

  @Post('invitations/accept')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary:
      'Accept an organization invitation (session must match invited email; token from email)',
  })
  acceptInvitation(
    @Body() dto: AcceptOrganizationInviteDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationInviteService.acceptInvite(
      dto.token,
      this.uid(req),
    );
  }

  @Get(':publicId/members')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({ summary: 'List organization members (members only)' })
  listMembers(@OrgMemberContextParam() ctx: OrganizationMemberContext) {
    return this.organizationsService.listMembers(ctx);
  }

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
    return this.organizationsService.setMemberWorkspacePermissions(
      ctx,
      dto.email,
      dto.permissions,
    );
  }

  @Delete(':publicId/membership')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({
    summary:
      'Leave organization. If you are the only owner and others remain, one member is promoted to owner; if you are alone, the org is dissolved. Multiple owners may leave without promoting others.',
  })
  leaveOrganization(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationsService.leaveOrganization(ctx, this.uid(req));
  }

  @Patch(':publicId/ownership')
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
      'Set a member’s role to owner or member (any organization owner; cannot remove the last owner)',
  })
  setMemberRole(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Body() dto: SetOrganizationMemberRoleDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationsService.setMemberRole(
      ctx,
      this.uid(req),
      dto.email,
      dto.role,
    );
  }

  @Post(':publicId/members')
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
      'Send invitation email (organization owners only; invitee must already have a Weehawk account)',
  })
  addMember(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Body() dto: AddOrganizationMemberDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationInviteService.sendMemberInvite(
      ctx,
      this.uid(req),
      dto.email,
    );
  }

  @Get(':publicId/projects')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({
    summary: 'List projects linked to this organization (organization_id set)',
  })
  listOrgProjects(@OrgMemberContextParam() ctx: OrganizationMemberContext) {
    return this.organizationsService.listProjectsForOrg(ctx);
  }

  @Get(':publicId/audit-log')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({
    summary:
      'List organization audit log (owners always; otherwise requires Management · Audit log permission)',
  })
  listAuditLog(@OrgMemberContextParam() ctx: OrganizationMemberContext) {
    return this.organizationsService.listAuditLogsForOrg(ctx);
  }

  @Patch(':publicId')
  @UseGuards(OrgMembershipGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Update organization (organization owners only; e.g. display name)',
  })
  updateOrganization(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.updateOrganization(ctx, dto);
  }

  @Get(':publicId')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({
    summary: 'Get organization by publicId (members only; same 404 when not a member)',
  })
  findOne(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationsService.getOnePublicForMember(ctx);
  }
}
