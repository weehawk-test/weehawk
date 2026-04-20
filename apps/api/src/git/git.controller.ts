import {
  BadRequestException,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { GitService } from './git.service';
import { UpdateGitSettingsDto } from './dto/update-git-settings.dto';
import { ExchangeGithubManifestDto } from './dto/exchange-github-manifest.dto';

@ApiTags('Git')
@Controller('api/git')
export class GitController {
  constructor(private readonly gitService: GitService) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  /**
   * GitHub fetches this when the user opens Register GitHub App with a manifest URL.
   * Must stay unauthenticated.
   */
  @Get('github/manifest')
  @ApiOperation({
    summary: 'GitHub App manifest JSON (GitHub servers GET this URL)',
  })
  getGithubManifest(@Req() req: ExpressRequest) {
    return this.gitService.buildGithubAppManifest(req);
  }

  @Post('github/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'GitHub App webhook receiver (placeholder)' })
  githubWebhookPlaceholder() {
    return { ok: true };
  }

  @Get('settings')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Git integration settings (secrets returned as booleans only)',
  })
  async getSettings(@Req() req: { user?: { userId: number } }) {
    return this.gitService.getSettings(this.uid(req));
  }

  @Get('gitlab/projects')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List GitLab projects (requires personal or group access token in Git settings)',
  })
  async listGitlabProjects(
    @Req() req: { user?: { userId: number } },
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    return this.gitService.listGitlabProjects(this.uid(req), {
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
      search,
    });
  }

  @Get('gitlab/projects/:projectId/branches')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List branch names for a GitLab project (requires GitLab token in settings)',
  })
  async listGitlabBranches(
    @Req() req: { user?: { userId: number } },
    @Param('projectId') projectId: string,
  ) {
    const id = parseInt(projectId, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('Invalid project id');
    }
    return this.gitService.listGitlabBranchNames(this.uid(req), id);
  }

  @Get('github/repositories')
  @UseGuards(LocalSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List GitHub repositories accessible to the configured GitHub App (across all installations)',
  })
  async listGithubRepositories(
    @Req() req: { user?: { userId: number } },
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    return this.gitService.listGithubRepositories(this.uid(req), {
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
  async listGithubBranches(
    @Req() req: { user?: { userId: number } },
    @Query('installationId') installationId: string,
    @Query('repo') repo: string,
  ) {
    const iid = parseInt(installationId, 10);
    if (!Number.isFinite(iid) || iid <= 0) {
      throw new BadRequestException('Invalid installationId');
    }
    const r = (repo ?? '').trim();
    if (!r) {
      throw new BadRequestException('repo query parameter is required (owner/repo)');
    }
    return this.gitService.listGithubBranchNames(this.uid(req), iid, r);
  }

  @Put('settings')
  @UseGuards(LocalSessionGuard)
  @ApiOperation({
    summary:
      'Update GitHub App / GitLab settings (partial). Send empty string to clear a secret.',
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updateSettings(@Req() req: { user?: { userId: number } }, @Body() dto: UpdateGitSettingsDto) {
    return this.gitService.updateSettings(this.uid(req), dto);
  }

  @Post('github/exchange')
  @UseGuards(LocalSessionGuard)
  @ApiOperation({
    summary:
      'Exchange GitHub App manifest temporary code for credentials and save to platform settings',
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async exchangeGithubManifest(@Req() req: { user?: { userId: number } }, @Body() dto: ExchangeGithubManifestDto) {
    return this.gitService.exchangeGithubManifestCode(this.uid(req), dto.code);
  }
}
