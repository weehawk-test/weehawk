import {
  BadRequestException,
  Req,
  UnauthorizedException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { RegistryService } from './registry.service';
import { CreateRegistryAccountDto } from './dto/create-registry-account.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { parseOrganizationPublicIdParam } from '../organizations/org-public-id';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';

@ApiTags('Registry')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/registry/accounts')
export class RegistryAccountsController {
  constructor(
    private readonly registryService: RegistryService,
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
    return parseOrganizationPublicIdParam(t);
  }

  @Get()
  @ApiOperation({
    summary:
      'List saved registry credentials for an organization (passwords never returned; Dokploy-style DB storage)',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description:
      'Organization workspace; caller must have registry integration access.',
  })
  async list(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
  ) {
    const userId = this.uid(req);
    const pub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      pub,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY,
      },
    );
    return this.registryService.listAccounts(ctx.internalId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Verify login in an isolated Docker config, then store encrypted credentials for push/pull automation',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description: 'Organization workspace; credentials are stored per organization.',
  })
  async create(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Body() dto: CreateRegistryAccountDto,
  ) {
    const userId = this.uid(req);
    const pub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      pub,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY,
      },
    );
    return this.registryService.createAccount(ctx.internalId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a saved registry account' })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description: 'Organization workspace.',
  })
  async remove(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId = this.uid(req);
    const pub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      pub,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY,
      },
    );
    return this.registryService.removeAccount(ctx.internalId, id);
  }
}
