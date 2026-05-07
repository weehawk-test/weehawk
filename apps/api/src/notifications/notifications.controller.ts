import {
  UnauthorizedException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { NotificationService } from './notification.service';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { PagedLogsQueryDto } from './dto/paged-logs-query.dto';
import { BulkDeleteChannelsDto } from './dto/bulk-delete-channels.dto';
import { ActiveOrganizationService } from '../organizations/active-organization.service';

type AuthedReq = { user?: { email: string; userId: number } };

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('/api/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationService,
    private readonly activeOrganizationService: ActiveOrganizationService,
  ) {}

  private userId(req?: AuthedReq): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private async resolveOrg(
    req: AuthedReq,
    activeOrgPublicId?: string,
  ): Promise<string | undefined> {
    const r = await this.activeOrganizationService.resolvePreferredOrganizationPublicId(
      this.userId(req),
      activeOrgPublicId,
    );
    return r ?? undefined;
  }

  @Get('channels')
  async listChannels(
    @Req() req: AuthedReq,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.notificationsService.listChannels(
      this.userId(req),
      org,
    );
  }

  @Get('channels/paged')
  async listChannelsPaged(@Req() req: AuthedReq, @Query() q: PagedLogsQueryDto) {
    const org = await this.resolveOrg(req, q.organizationPublicId);
    return this.notificationsService.listChannelsPaged(
      this.userId(req),
      q.page,
      q.pageSize,
      q.q,
      org,
    );
  }

  @Post('channels/bulk-delete')
  async bulkDeleteChannels(
    @Req() req: AuthedReq,
    @Body() dto: BulkDeleteChannelsDto,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.notificationsService.bulkDeleteChannels(
      this.userId(req),
      dto.ids,
      org,
    );
  }

  @Post('channels')
  createChannel(
    @Req() req: AuthedReq,
    @Body() dto: CreateNotificationChannelDto,
  ) {
    return this.notificationsService.createChannel(this.userId(req), dto);
  }

  @Patch('channels/:id')
  async updateChannel(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateNotificationChannelDto,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.notificationsService.updateChannel(
      this.userId(req),
      id,
      dto,
      org,
    );
  }

  @Delete('channels/:id')
  async deleteChannel(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    await this.notificationsService.deleteChannel(
      this.userId(req),
      id,
      org,
    );
    return { ok: true };
  }

  @Post('channels/:id/test')
  async testChannel(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.notificationsService.testChannel(
      this.userId(req),
      id,
      org,
    );
  }
}
