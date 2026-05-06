import {
  BadRequestException,
  Delete,
  Req,
  UnauthorizedException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { GitService } from './git.service';
import { UpdateGitSettingsDto } from './dto/update-git-settings.dto';
import { ExchangeGithubManifestDto } from './dto/exchange-github-manifest.dto';
import { RedisService } from '../common/redis/redis.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { parseOrganizationPublicIdParam } from '../organizations/org-public-id';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';

@ApiTags('Git')
@Controller('api/git')
export class GitController {
  private readonly seenGithubDeliveries = new Map<string, number>();
  private static readonly GITHUB_DELIVERY_TTL_MS = 15 * 60 * 1000;

  constructor(
    private readonly gitService: GitService,
    private readonly redisService: RedisService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  private replayKey(deliveryId: string): string {
    return `github:webhook:delivery:${deliveryId}`;
  }

  private async markGithubDeliveryIfNew(deliveryId: string): Promise<boolean> {
    const key = this.replayKey(deliveryId);
    try {
      const result = await this.redisService.eval(
        `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('PSETEX', KEYS[1], ARGV[1], '1')
return 1
`,
        [key],
        [String(GitController.GITHUB_DELIVERY_TTL_MS)],
      );
      return Number(result) === 1;
    } catch {
      const now = Date.now();
      for (const [seenKey, expiresAt] of this.seenGithubDeliveries.entries()) {
        if (expiresAt <= now) this.seenGithubDeliveries.delete(seenKey);
      }
      if (this.seenGithubDeliveries.has(deliveryId)) {
        return false;
      }
      this.seenGithubDeliveries.set(
        deliveryId,
        now + GitController.GITHUB_DELIVERY_TTL_MS,
      );
      return true;
    }
  }

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

  /** Audit metadata for Git settings updates — no secret values. */
  private static gitSettingsUpdateAuditMetadata(
    dto: UpdateGitSettingsDto,
  ): Record<string, unknown> {
    const fieldsUpdated: string[] = [];
    if (dto.githubAppId !== undefined) fieldsUpdated.push('githubAppId');
    if (dto.githubClientId !== undefined) fieldsUpdated.push('githubClientId');
    if (dto.githubAppSlug !== undefined) fieldsUpdated.push('githubAppSlug');
    if (dto.gitlabBaseUrl !== undefined) fieldsUpdated.push('gitlabBaseUrl');
    const secretsTouched: string[] = [];
    if (dto.githubClientSecret !== undefined) {
      secretsTouched.push('githubClientSecret');
    }
    if (dto.githubPrivateKey !== undefined) {
      secretsTouched.push('githubPrivateKey');
    }
    if (dto.githubWebhookSecret !== undefined) {
      secretsTouched.push('githubWebhookSecret');
    }
    if (dto.gitlabGroupAccessToken !== undefined) {
      secretsTouched.push('gitlabGroupAccessToken');
    }
    const touchedGithub =
      fieldsUpdated.some((f) => f.startsWith('github')) ||
      secretsTouched.some((s) => s.startsWith('github'));
    const touchedGitlab =
      fieldsUpdated.includes('gitlabBaseUrl') ||
      secretsTouched.includes('gitlabGroupAccessToken');
    let gitTarget: string | undefined;
    if (touchedGithub && touchedGitlab) {
      gitTarget = 'GitHub / GitLab';
    } else if (touchedGithub) {
      gitTarget = 'GitHub';
    } else if (touchedGitlab) {
      gitTarget = 'GitLab';
    }
    return {
      endpoint: 'PUT /api/git/settings',
      fieldsUpdated,
      secretsTouched,
      ...(gitTarget != null ? { gitTarget } : {}),
    };
  }

  /**
   * GitHub fetches this when the user opens Register GitHub App with a manifest URL.
   * Must stay unauthenticated.
   */
  @Get('github/manifest')
  @ApiOperation({
    summary: 'GitHub App manifest JSON (GitHub servers GET this URL)',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description:
      'Organization workspace; callback URL includes this so credentials save to the correct org.',
  })
  getGithubManifest(
    @Req() req: ExpressRequest,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    const pub = this.parseRequiredOrgPublicId(organizationPublicId);
    return this.gitService.buildGithubAppManifest(req, pub);
  }

  @Post('github/webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'GitHub App webhook receiver (signed requests only)',
  })
  async githubWebhookPlaceholder(
    @Req()
    req: ExpressRequest & {
      headers: Record<string, string | string[] | undefined>;
      rawBody?: Buffer;
    },
  ) {
    const deliveryHeader = req.headers['x-github-delivery'];
    const deliveryId = (
      Array.isArray(deliveryHeader) ? deliveryHeader[0] : (deliveryHeader ?? '')
    ).trim();
    if (!deliveryId) {
      throw new UnauthorizedException('Missing GitHub delivery id');
    }
    const accepted = await this.markGithubDeliveryIfNew(deliveryId);
    if (!accepted) {
      throw new UnauthorizedException('Replay detected');
    }
    const appIdHeader = req.headers['x-github-hook-installation-target-id'];
    const appId = Array.isArray(appIdHeader) ? appIdHeader[0] : appIdHeader;
    const sig = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(sig) ? sig[0] : sig;
    const verified = await this.gitService.verifyGithubWebhookSignature(
      appId,
      signature,
      req.rawBody,
    );
    if (!verified) {
      try {
        await this.redisService.del(this.replayKey(deliveryId));
      } catch {
        this.seenGithubDeliveries.delete(deliveryId);
      }
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
    return { ok: true };
  }

  @Get('settings')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get Git integration settings for an organization (secrets returned as booleans only)',
  })
  @ApiQuery({
    name: 'organizationPublicId',
    required: true,
    description: 'Organization workspace; caller must have Git integration access.',
  })
  async getSettings(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
  ) {
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    return this.gitService.getSettings(ctx.internalId);
  }

  @Get('gitlab/projects')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List GitLab projects (requires personal or group access token in Git settings)',
  })
  @ApiQuery({ name: 'organizationPublicId', required: true })
  async listGitlabProjects(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    return this.gitService.listGitlabProjects(ctx.internalId, {
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
      search,
    });
  }

  @Get('gitlab/projects/:projectId/branches')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List branch names for a GitLab project (requires GitLab token in settings)',
  })
  @ApiQuery({ name: 'organizationPublicId', required: true })
  async listGitlabBranches(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Param('projectId') projectId: string,
  ) {
    const id = parseInt(projectId, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('Invalid project id');
    }
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    return this.gitService.listGitlabBranchNames(ctx.internalId, id);
  }

  @Get('github/repositories')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List GitHub repositories accessible to the configured GitHub App (across all installations)',
  })
  @ApiQuery({ name: 'organizationPublicId', required: true })
  async listGithubRepositories(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    return this.gitService.listGithubRepositories(ctx.internalId, {
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
      search,
    });
  }

  @Get('github/branches')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List branch names for a repo (installation access token; repo = owner/name)',
  })
  @ApiQuery({ name: 'organizationPublicId', required: true })
  async listGithubBranches(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Query('installationId') installationId: string,
    @Query('repo') repo: string,
  ) {
    const iid = parseInt(installationId, 10);
    if (!Number.isFinite(iid) || iid <= 0) {
      throw new BadRequestException('Invalid installationId');
    }
    const r = (repo ?? '').trim();
    if (!r) {
      throw new BadRequestException(
        'repo query parameter is required (owner/repo)',
      );
    }
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    return this.gitService.listGithubBranchNames(ctx.internalId, iid, r);
  }

  @Put('settings')
  @UseGuards(LocalSessionGuard)
  @ApiOperation({
    summary:
      'Update GitHub App / GitLab settings for an organization (partial). Send empty string to clear a secret.',
  })
  @ApiQuery({ name: 'organizationPublicId', required: true })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updateSettings(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Body() dto: UpdateGitSettingsDto,
  ) {
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    const result = await this.gitService.updateSettings(ctx.internalId, dto);
    void this.organizationsService
      .appendOrganizationAuditEvent(
        ctx.internalId,
        userId,
        'security.git.settings_updated',
        {
          metadata: GitController.gitSettingsUpdateAuditMetadata(dto),
        },
      )
      .catch(() => undefined);
    return result;
  }

  @Post('github/exchange')
  @UseGuards(LocalSessionGuard)
  @ApiOperation({
    summary:
      'Exchange GitHub App manifest temporary code for credentials and save to organization settings',
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async exchangeGithubManifest(
    @Req() req: { user?: { userId: number } },
    @Body() dto: ExchangeGithubManifestDto,
  ) {
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      dto.organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    const result = await this.gitService.exchangeGithubManifestCode(
      ctx.internalId,
      dto.code,
    );
    void this.organizationsService
      .appendOrganizationAuditEvent(
        ctx.internalId,
        userId,
        'security.git.github_manifest_exchanged',
        {
          metadata: {
            endpoint: 'POST /api/git/github/exchange',
            gitTarget: 'GitHub',
            githubAppId: result.github.appId,
            githubAppSlug: result.github.appSlug,
          },
        },
      )
      .catch(() => undefined);
    return result;
  }

  @Delete('accounts/:accountPublicId')
  @UseGuards(LocalSessionGuard)
  @ApiOperation({
    summary: 'Delete saved Git account by public id',
  })
  @ApiQuery({ name: 'organizationPublicId', required: true })
  async deleteAccount(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') organizationPublicId: string,
    @Param('accountPublicId') accountPublicId: string,
  ) {
    const userId = this.uid(req);
    const ctx = await this.organizationsService.requireMemberContext(
      organizationPublicId,
      userId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.GIT },
    );
    return this.gitService.removeAccount(ctx.internalId, accountPublicId);
  }
}
