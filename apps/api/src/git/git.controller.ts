import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GitService } from './git.service';
import { UpdateGitSettingsDto } from './dto/update-git-settings.dto';
import { ExchangeGithubManifestDto } from './dto/exchange-github-manifest.dto';

@ApiTags('Git')
@Controller('api/git')
export class GitController {
  constructor(private readonly gitService: GitService) {}

  /**
   * GitHub fetches this when the user opens Register GitHub App with a manifest URL.
   * Must stay unauthenticated.
   */
  @Get('github/manifest')
  @ApiOperation({
    summary: 'GitHub App manifest JSON (GitHub servers GET this URL)',
  })
  getGithubManifest() {
    return this.gitService.buildGithubAppManifest();
  }

  @Post('github/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'GitHub App webhook receiver (placeholder)' })
  githubWebhookPlaceholder() {
    return { ok: true };
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Git integration settings (secrets returned as booleans only)',
  })
  async getSettings() {
    return this.gitService.getSettings();
  }

  @Get('gitlab/projects')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List GitLab projects (requires personal or group access token in Git settings)',
  })
  async listGitlabProjects(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    return this.gitService.listGitlabProjects({
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
      search,
    });
  }

  @Get('github/repositories')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List GitHub repositories accessible to the configured GitHub App (across all installations)',
  })
  async listGithubRepositories(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    return this.gitService.listGithubRepositories({
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
      search,
    });
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
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
  async updateSettings(@Body() dto: UpdateGitSettingsDto) {
    return this.gitService.updateSettings(dto);
  }

  @Post('github/exchange')
  @UseGuards(JwtAuthGuard)
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
  async exchangeGithubManifest(@Body() dto: ExchangeGithubManifestDto) {
    return this.gitService.exchangeGithubManifestCode(dto.code);
  }
}
