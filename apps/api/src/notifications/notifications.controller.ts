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
  constructor(private readonly notificationsService: NotificationService) {}

  private userId(req?: AuthedReq): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Get('channels')
  listChannels(
    @Req() req: AuthedReq,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.notificationsService.listChannels(
      this.userId(req),
      organizationPublicId,
    );
  }

  @Get('channels/paged')
  listChannelsPaged(@Req() req: AuthedReq, @Query() q: PagedLogsQueryDto) {
    return this.notificationsService.listChannelsPaged(
      this.userId(req),
      q.page,
      q.pageSize,
      q.q,
      q.organizationPublicId,
    );
  }

  @Post('channels/bulk-delete')
  async bulkDeleteChannels(
    @Req() req: AuthedReq,
    @Body() dto: BulkDeleteChannelsDto,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.notificationsService.bulkDeleteChannels(
      this.userId(req),
      dto.ids,
      organizationPublicId,
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
  updateChannel(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateNotificationChannelDto,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.notificationsService.updateChannel(
      this.userId(req),
      id,
      dto,
      organizationPublicId,
    );
  }

  @Delete('channels/:id')
  async deleteChannel(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    await this.notificationsService.deleteChannel(
      this.userId(req),
      id,
      organizationPublicId,
    );
    return { ok: true };
  }

  @Post('channels/:id/test')
  testChannel(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.notificationsService.testChannel(
      this.userId(req),
      id,
      organizationPublicId,
    );
  }
}
