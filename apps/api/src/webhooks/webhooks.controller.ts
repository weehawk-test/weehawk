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
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.webhooksService.list(this.uid(req), {
      includeHidden,
      organizationPublicId,
    });
  }

  @Get(':id')
  findOne(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.webhooksService.findOne(this.uid(req), id, organizationPublicId);
  }

  @Get(':id/last-log')
  readLastRunLog(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('lines', new DefaultValuePipe(200)) lines: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    const n = Number(lines);
    return this.webhooksService.readLastRunLog(this.uid(req), id, {
      lines: Number.isFinite(n) ? n : 200,
      organizationPublicId,
    });
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.webhooksService.update(
      this.uid(req),
      id,
      dto,
      organizationPublicId,
    );
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    await this.webhooksService.remove(this.uid(req), id, organizationPublicId);
    return { ok: true };
  }
}
