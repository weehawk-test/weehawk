import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { TraefikService } from './traefik.service';
import { UpdateTraefikSettingsDto } from './dto/update-traefik-settings.dto';

@ApiTags('Traefik')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/traefik')
export class TraefikController {
  constructor(private readonly traefikService: TraefikService) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Get('settings')
  @ApiOperation({
    summary:
      'Get Traefik / ACME settings and generated compose + static YAML previews',
  })
  getSettings(@Req() req: { user?: { userId: number } }) {
    return this.traefikService.getResponsePayload(this.uid(req));
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update Traefik / ACME settings' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async putSettings(
    @Req() req: { user?: { userId: number } },
    @Body() dto: UpdateTraefikSettingsDto,
  ) {
    const userId = this.uid(req);
    await this.traefikService.updateSettings(userId, dto);
    return this.traefikService.getResponsePayload(userId);
  }
}
