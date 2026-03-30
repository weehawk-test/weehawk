import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { TestTelegramCredentialsDto } from './dto/test-telegram-credentials.dto';
import { PagedLogsQueryDto } from './dto/paged-logs-query.dto';
import { BulkDeleteLogsDto } from './dto/bulk-delete-logs.dto';
import { BulkDeleteChannelsDto } from './dto/bulk-delete-channels.dto';

type AuthedReq = { user?: { userId: number; email: string } };

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('/api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  private userId(req: AuthedReq): number {
    const id = req.user?.userId;
    if (id == null) throw new UnauthorizedException();
    return id;
  }

  @Get('channels')
  listChannels(@Req() req: AuthedReq) {
    return this.notificationsService.listChannels(this.userId(req));
  }

  @Get('channels/paged')
  listChannelsPaged(@Req() req: AuthedReq, @Query() q: PagedLogsQueryDto) {
    return this.notificationsService.listChannelsPaged(this.userId(req), q.page, q.pageSize, q.q);
  }

  @Post('channels/bulk-delete')
  async bulkDeleteChannels(@Req() req: AuthedReq, @Body() dto: BulkDeleteChannelsDto) {
    return this.notificationsService.bulkDeleteChannels(this.userId(req), dto.ids);
  }

  @Post('test-credentials')
  testCredentials(@Req() req: AuthedReq, @Body() dto: TestTelegramCredentialsDto) {
    return this.notificationsService.testTelegramCredentials(
      this.userId(req),
      dto.botToken,
      dto.chatId,
      dto.channelName,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationChannelDto,
  ) {
    return this.notificationsService.updateChannel(this.userId(req), id, dto);
  }

  @Delete('channels/:id')
  async deleteChannel(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.deleteChannel(this.userId(req), id);
    return { ok: true };
  }

  @Post('channels/:id/test')
  testChannel(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.testChannel(this.userId(req), id);
  }

  @Get('logs')
  listLogs(@Req() req: AuthedReq) {
    return this.notificationsService.listLogs(this.userId(req));
  }

  @Get('logs/paged')
  listLogsPaged(@Req() req: AuthedReq, @Query() q: PagedLogsQueryDto) {
    return this.notificationsService.listLogsPaged(this.userId(req), q.page, q.pageSize, q.q);
  }

  @Delete('logs/:id')
  async deleteLog(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    await this.notificationsService.deleteLog(this.userId(req), id);
    return { ok: true };
  }

  @Post('logs/bulk-delete')
  async bulkDeleteLogs(@Req() req: AuthedReq, @Body() dto: BulkDeleteLogsDto) {
    return this.notificationsService.bulkDeleteLogs(this.userId(req), dto.ids);
  }

  @Post('send')
  send(@Req() req: AuthedReq, @Body() dto: SendNotificationDto) {
    return this.notificationsService.sendMessage(
      this.userId(req),
      dto.channelId,
      dto.message,
    );
  }
}
