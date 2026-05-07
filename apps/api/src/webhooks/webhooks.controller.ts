import {
  UnauthorizedException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhooksService } from './webhooks.service';
import { ActiveOrganizationService } from '../organizations/active-organization.service';

type AuthedReq = { user?: { email: string; userId: number } };

@ApiTags('Triggers')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('api/webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly activeOrganizationService: ActiveOrganizationService,
  ) {}

  private uid(req?: AuthedReq): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private async resolveOrg(
    req: AuthedReq,
    activeOrgPublicId?: string,
  ): Promise<string | undefined> {
    const r = await this.activeOrganizationService.resolvePreferredOrganizationPublicId(
      this.uid(req),
      activeOrgPublicId,
    );
    return r ?? undefined;
  }

  @Post()
  create(@Req() req: AuthedReq, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(this.uid(req), dto);
  }

  @Get()
  async list(
    @Req() req: AuthedReq,
    @Query('includeHidden', new DefaultValuePipe(false), ParseBoolPipe)
    includeHidden: boolean,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.webhooksService.list(this.uid(req), {
      includeHidden,
      organizationPublicId: org,
    });
  }

  @Get(':id')
  async findOne(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.webhooksService.findOne(this.uid(req), id, org);
  }

  @Get(':id/last-log')
  async readLastRunLog(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('lines', new DefaultValuePipe(200)) lines: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const n = Number(lines);
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.webhooksService.readLastRunLog(this.uid(req), id, {
      lines: Number.isFinite(n) ? n : 200,
      organizationPublicId: org,
    });
  }

  @Patch(':id')
  async update(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.webhooksService.update(
      this.uid(req),
      id,
      dto,
      org,
    );
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    await this.webhooksService.remove(this.uid(req), id, org);
    return { ok: true };
  }
}
