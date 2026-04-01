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
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhooksService } from './webhooks.service';

type AuthedReq = { user?: { userId: number; email: string } };

@ApiTags('Triggers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('api/webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  private uid(req: AuthedReq): number {
    const id = req.user?.userId;
    if (id == null) throw new UnauthorizedException();
    return id;
  }

  @Post()
  create(@Req() req: AuthedReq, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(this.uid(req), dto);
  }

  @Get()
  list(@Req() req: AuthedReq) {
    return this.webhooksService.list(this.uid(req));
  }

  @Get(':id')
  findOne(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.findOne(this.uid(req), id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(this.uid(req), id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    await this.webhooksService.remove(this.uid(req), id);
    return { ok: true };
  }
}
