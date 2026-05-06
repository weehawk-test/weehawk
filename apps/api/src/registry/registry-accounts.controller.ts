import {
  BadRequestException,
  Req,
  UnauthorizedException,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
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
import { UpdateRegistryAccountDto } from './dto/update-registry-account.dto';
import { TestRegistryAccountDto } from './dto/test-registry-account.dto';
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
        requireAllWorkspaceAreas: [
          ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY_ADD,
        ],
      },
    );
    const upsert = await this.registryService.createAccount(ctx.internalId, dto);
    void this.organizationsService
      .appendOrganizationAuditEvent(ctx.internalId, userId, 'security.registry.account_created', {
        metadata: {
          endpoint: 'POST /api/registry/accounts',
          registryAccountPublicId: upsert.account.publicId,
          registryAccountId: upsert.account.id,
          registryAccountName: upsert.account.name,
          registryProviderUrl: upsert.account.providerUrl,
        },
      })
      .catch(() => undefined);
    return upsert.account;
  }

  @Delete(':accountRef')
  @ApiOperation({
    summary:
      'Remove a saved registry account (use account publicId, or legacy numeric id)',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description: 'Organization workspace.',
  })
  async remove(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Param('accountRef') accountRef: string,
  ) {
    const userId = this.uid(req);
    const pub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      pub,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY,
        requireAllWorkspaceAreas: [
          ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY_DELETE,
        ],
      },
    );
    const out = await this.registryService.removeAccount(
      ctx.internalId,
      accountRef,
    );
    void this.organizationsService
      .appendOrganizationAuditEvent(
        ctx.internalId,
        userId,
        'security.registry.account_deleted',
        {
          metadata: {
            endpoint: `DELETE /api/registry/accounts/${out.removed.publicId}`,
            registryAccountPublicId: out.removed.publicId,
            registryAccountId: out.removed.id,
            registryAccountName: out.removed.name,
            registryProviderUrl: out.removed.providerUrl,
          },
        },
      )
      .catch(() => undefined);
    return { success: true as const };
  }

  @Patch(':accountRef')
  @ApiOperation({
    summary: 'Update a saved registry account (name/provider/username/password)',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description: 'Organization workspace.',
  })
  async update(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Param('accountRef') accountRef: string,
    @Body() dto: UpdateRegistryAccountDto,
  ) {
    const userId = this.uid(req);
    const pub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      pub,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY,
        requireAllWorkspaceAreas: [
          ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY_EDIT,
        ],
      },
    );
    const updated = await this.registryService.updateAccount(
      ctx.internalId,
      accountRef,
      dto,
    );
    void this.organizationsService
      .appendOrganizationAuditEvent(
        ctx.internalId,
        userId,
        'security.registry.account_updated',
        {
          metadata: {
            endpoint: `PATCH /api/registry/accounts/${updated.publicId}`,
            registryAccountPublicId: updated.publicId,
            registryAccountId: updated.id,
            registryAccountName: updated.name,
            registryProviderUrl: updated.providerUrl,
          },
        },
      )
      .catch(() => undefined);
    return updated;
  }

  @Post(':accountRef/test')
  @ApiOperation({
    summary: 'Test a saved registry account on a selected deploy server',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description: 'Organization workspace.',
  })
  async testSavedAccount(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Param('accountRef') accountRef: string,
    @Body() dto: TestRegistryAccountDto,
  ) {
    const userId = this.uid(req);
    const pub = this.parseRequiredOrgPublicId(organizationPublicId);
    const ctx = await this.organizationsService.requireMemberContext(
      pub,
      userId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY,
        requireAllWorkspaceAreas: [
          ORGANIZATION_WORKSPACE_PERMISSIONS.REGISTRY_TEST,
        ],
      },
    );
    return this.registryService.testSavedAccountFromRemote(
      ctx.internalId,
      accountRef,
      dto.remoteServerRef,
      userId,
    );
  }
}
