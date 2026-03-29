import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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

  @Post('send')
  send(@Req() req: AuthedReq, @Body() dto: SendNotificationDto) {
    return this.notificationsService.sendMessage(
      this.userId(req),
      dto.channelId,
      dto.message,
    );
  }
}
