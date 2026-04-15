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
  constructor(private readonly webhooksService: WebhooksService) {}

  private uid(req?: AuthedReq): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Post()
  create(@Req() req: AuthedReq, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(this.uid(req), dto);
  }

  @Get()
  list(
    @Req() req: AuthedReq,
    @Query('includeHidden', new DefaultValuePipe(false), ParseBoolPipe)
    includeHidden: boolean,
  ) {
    return this.webhooksService.list(this.uid(req), { includeHidden });
  }

  @Get(':id')
  findOne(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.webhooksService.findOne(this.uid(req), id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(this.uid(req), id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: AuthedReq, @Param('id') id: string) {
    await this.webhooksService.remove(this.uid(req), id);
    return { ok: true };
  }
}
