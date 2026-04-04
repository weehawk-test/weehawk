import { Body, Controller, Get, Put, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TraefikService } from './traefik.service';
import { UpdateTraefikSettingsDto } from './dto/update-traefik-settings.dto';

@ApiTags('Traefik')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/traefik')
export class TraefikController {
  constructor(private readonly traefikService: TraefikService) {}

  @Get('settings')
  @ApiOperation({
    summary: 'Get Traefik / ACME settings and generated compose + static YAML previews',
  })
  getSettings() {
    return this.traefikService.getResponsePayload();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update Traefik / ACME settings' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async putSettings(@Body() dto: UpdateTraefikSettingsDto) {
    await this.traefikService.updateSettings(dto);
    return this.traefikService.getResponsePayload();
  }
}
