import {
  Body,
  Controller,
  Get,
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
import { OrgMembershipGuard } from './guards/org-membership.guard';
import { OrgMemberContextParam } from './decorators/organization-member-context.decorator';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

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

  @Get(':publicId/members')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({ summary: 'List organization members (members only)' })
  listMembers(@OrgMemberContextParam() ctx: OrganizationMemberContext) {
    return this.organizationsService.listMembers(ctx);
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
    summary: 'Invite a user by email (organization owner only; user must already exist)',
  })
  addMember(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Body() dto: AddOrganizationMemberDto,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationsService.addMemberByEmail(
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

  @Get(':publicId')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({
    summary: 'Get organization by publicId (members only; same 404 when not a member)',
  })
  findOne(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Req() req: { user?: { userId: number } },
  ) {
    return this.organizationsService.memberContextToPublicDto(
      ctx,
      this.uid(req),
    );
  }
}
