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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhooksService } from './webhooks.service';

type AuthedReq = { user?: { email: string } };

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
  constructor(private readonly webhooksService: WebhooksService) {}

  private uid(_req?: unknown): number {
    return 1;
  }

  @Post()
  create(@Req() req: AuthedReq, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(this.uid(), dto);
  }

  @Get()
  list(@Req() req: AuthedReq) {
    return this.webhooksService.list(this.uid());
  }

  @Get(':id')
  findOne(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.findOne(this.uid(), id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(this.uid(), id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    await this.webhooksService.remove(this.uid(), id);
    return { ok: true };
  }
}
