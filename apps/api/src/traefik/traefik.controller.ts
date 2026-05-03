import {
  BadRequestException,
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

  private parseRequiredOrgPublicId(raw: string | undefined): string {
    const t = raw?.trim() ?? '';
    if (!t) {
      throw new BadRequestException('organizationPublicId is required');
    }
    return t;
  }

  @Get('settings')
  @ApiOperation({
    summary:
      'Get Traefik / ACME settings and generated compose + static YAML previews (organization-scoped)',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description: 'Organization workspace; caller must have Domains access.',
  })
  async getSettings(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
  ) {
    const userId = this.uid(req);
    const orgPub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      orgPub,
      userId,
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
    required: true,
    description:
      'Organization workspace; caller must have Domains + certificate email permission when not owner.',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async putSettings(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string | undefined,
    @Body() dto: UpdateTraefikSettingsDto,
  ) {
    const userId = this.uid(req);
    const orgPub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      orgPub,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.DOMAINS,
      },
    );
    await this.organizationsService.assertMemberCanEditOrgDomainsCertificateEmail(
      userId,
      ctx.internalId,
    );
    await this.traefikService.updateSettingsForOrganization(ctx.internalId, dto);
    return this.traefikService.getResponsePayloadForOrganization(ctx.internalId);
  }
}
