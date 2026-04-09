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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { NotificationService } from './notification.service';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { TestTelegramCredentialsDto } from './dto/test-telegram-credentials.dto';
import { PagedLogsQueryDto } from './dto/paged-logs-query.dto';
import { BulkDeleteLogsDto } from './dto/bulk-delete-logs.dto';
import { BulkDeleteChannelsDto } from './dto/bulk-delete-channels.dto';

type AuthedReq = { user?: { email: string } };

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

  private userId(_req?: unknown): number {
    return 1;
  }

  @Get('channels')
  listChannels(@Req() req: AuthedReq) {
    return this.notificationsService.listChannels(this.userId());
  }

  @Get('channels/paged')
  listChannelsPaged(@Req() req: AuthedReq, @Query() q: PagedLogsQueryDto) {
    return this.notificationsService.listChannelsPaged(
      this.userId(),
      q.page,
      q.pageSize,
      q.q,
    );
  }

  @Post('channels/bulk-delete')
  async bulkDeleteChannels(
    @Req() req: AuthedReq,
    @Body() dto: BulkDeleteChannelsDto,
  ) {
    return this.notificationsService.bulkDeleteChannels(
      this.userId(),
      dto.ids,
    );
  }

  @Post('test-credentials')
  testCredentials(
    @Req() req: AuthedReq,
    @Body() dto: TestTelegramCredentialsDto,
  ) {
    return this.notificationsService.testTelegramCredentials(
      this.userId(),
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
    return this.notificationsService.createChannel(this.userId(), dto);
  }

  @Patch('channels/:id')
  updateChannel(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationChannelDto,
  ) {
    return this.notificationsService.updateChannel(this.userId(), id, dto);
  }

  @Delete('channels/:id')
  async deleteChannel(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.deleteChannel(this.userId(), id);
    return { ok: true };
  }

  @Post('channels/:id/test')
  testChannel(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.testChannel(this.userId(), id);
  }

  @Get('logs')
  listLogs(@Req() req: AuthedReq) {
    return this.notificationsService.listLogs(this.userId());
  }

  @Get('logs/paged')
  listLogsPaged(@Req() req: AuthedReq, @Query() q: PagedLogsQueryDto) {
    return this.notificationsService.listLogsPaged(
      this.userId(),
      q.page,
      q.pageSize,
      q.q,
    );
  }

  @Delete('logs/:id')
  async deleteLog(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.deleteLog(this.userId(), id);
    return { ok: true };
  }

  @Post('logs/bulk-delete')
  async bulkDeleteLogs(@Req() req: AuthedReq, @Body() dto: BulkDeleteLogsDto) {
    return this.notificationsService.bulkDeleteLogs(this.userId(), dto.ids);
  }

  @Post('send')
  send(@Req() req: AuthedReq, @Body() dto: SendNotificationDto) {
    return this.notificationsService.sendMessage(
      this.userId(),
      dto.channelId,
      dto.message,
    );
  }
}
