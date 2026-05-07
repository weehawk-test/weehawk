import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { TraefikService } from './traefik.service';
import { UpdateTraefikSettingsDto } from './dto/update-traefik-settings.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';
import { ActiveOrganizationService } from '../organizations/active-organization.service';

@ApiTags('Traefik')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/traefik')
export class TraefikController {
  constructor(
    private readonly traefikService: TraefikService,
    private readonly organizationsService: OrganizationsService,
    private readonly activeOrganizationService: ActiveOrganizationService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Get('settings')
  @ApiOperation({
    summary:
      'Get Traefik / ACME settings and generated compose + static YAML previews (organization-scoped)',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'Organization workspace; optional when active organization is already set server-side.',
  })
  async getSettings(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    const userId = this.uid(req);
    const ctx = await this.activeOrganizationService.resolveRequiredMemberContext(
      userId,
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS,
      },
    );
    return this.traefikService.getResponsePayloadForOrganization(ctx.internalId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update Traefik / ACME settings (organization-scoped)' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: false,
    description:
      'Organization workspace; optional when active organization is already set server-side.',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async putSettings(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Body() dto: UpdateTraefikSettingsDto,
  ) {
    const userId = this.uid(req);
    const ctx = await this.activeOrganizationService.resolveRequiredMemberContext(
      userId,
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS,
      },
    );
    await this.organizationsService.assertMemberCanEditOrgDomainsCertificateEmail(
      userId,
      ctx.internalId,
    );
    const before = await this.traefikService.getSettingsForOrganization(
      ctx.internalId,
    );
    await this.traefikService.updateSettingsForOrganization(ctx.internalId, dto);
    const after = await this.traefikService.getSettingsForOrganization(
      ctx.internalId,
    );
    const endpoint = 'PUT /api/traefik/settings';
    if (
      dto.acmeEmail !== undefined &&
      before.acmeEmail.trim() !== after.acmeEmail.trim()
    ) {
      await this.organizationsService.appendOrganizationAuditEvent(
        ctx.internalId,
        userId,
        'domains.acme_email_updated',
        {
          metadata: {
            endpoint,
            previousAcmeEmail: before.acmeEmail,
            acmeEmail: after.acmeEmail,
          },
        },
      );
    }
    if (dto.platformDomain !== undefined) {
      const prevPd = (before.platformDomain ?? '').trim();
      const nextPd = (after.platformDomain ?? '').trim();
      if (prevPd !== nextPd) {
        await this.organizationsService.appendOrganizationAuditEvent(
          ctx.internalId,
          userId,
          'domains.platform_hostname_updated',
          {
            metadata: {
              endpoint,
              platformDomainPrevious: prevPd || null,
              platformDomain: nextPd || null,
            },
          },
        );
      }
    }
    return this.traefikService.getResponsePayloadForOrganization(ctx.internalId);
  }
}
