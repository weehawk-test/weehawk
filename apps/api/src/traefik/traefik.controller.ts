import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { TraefikService } from './traefik.service';
import { UpdateTraefikSettingsDto } from './dto/update-traefik-settings.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';

@ApiTags('Traefik')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/traefik')
export class TraefikController {
  constructor(
    private readonly traefikService: TraefikService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Get('settings')
  @ApiOperation({
    summary:
      'Get Traefik / ACME settings and generated compose + static YAML previews',
  })
  getSettings(@Req() req: { user?: { userId: number } }) {
    return this.traefikService.getResponsePayload(this.uid(req));
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update Traefik / ACME settings' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'When set, caller must be an org member with Domains + Certificate email sub-permission (org Domains page).',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async putSettings(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string | undefined,
    @Body() dto: UpdateTraefikSettingsDto,
  ) {
    const userId = this.uid(req);
    const orgRaw = organizationPublicId?.trim();
    if (orgRaw) {
      const ctx = await this.organizationsService.requireMemberContext(
        orgRaw,
        userId,
        {
          requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS,
        },
      );
      await this.organizationsService.assertMemberCanEditOrgDomainsCertificateEmail(
        userId,
        ctx.internalId,
      );
    }
    await this.traefikService.updateSettings(userId, dto);
    return this.traefikService.getResponsePayload(userId);
  }
}
