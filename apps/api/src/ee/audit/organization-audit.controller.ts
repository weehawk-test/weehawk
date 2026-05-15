import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { LocalSessionGuard } from '../../common/guards/local-session.guard';
import { OrgMembershipGuard } from '../../organizations/guards/org-membership.guard';
import { OrgMemberContextParam } from '../../organizations/decorators/organization-member-context.decorator';
import type { OrganizationMemberContext } from '../../organizations/organization-member-context';
import { OrganizationAuditService } from './organization-audit.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/organizations')
export class OrganizationAuditController {
  constructor(private readonly organizationAuditService: OrganizationAuditService) {}

  @Get(':publicId/audit-log')
  @UseGuards(OrgMembershipGuard)
  @ApiOperation({
    summary:
      'List organization audit log (owners always; otherwise requires Management · Audit log permission)',
  })
  @ApiQuery({ name: 'page', required: false, description: '1-based page index (default 1)' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    description: 'Rows per page (default 12, max 50)',
  })
  listAuditLog(
    @OrgMemberContextParam() ctx: OrganizationMemberContext,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(12), ParseIntPipe) pageSize: number,
  ) {
    return this.organizationAuditService.listAuditLogsForOrg(ctx, {
      page,
      pageSize,
    });
  }
}
