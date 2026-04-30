import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { RegistryService } from './registry.service';
import { LoginRegistryDto } from './dto/login-registry.dto';
import { LogoutRegistryDto } from './dto/logout-registry.dto';
import { VerifyRegistryConnectionDto } from './dto/verify-registry-connection.dto';

@ApiTags('Registry')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/registry')
export class RegistryController {
  constructor(private readonly registryService: RegistryService) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Post('login')
  @ApiOperation({ summary: 'Login to a Docker registry' })
  async login(@Body() dto: LoginRegistryDto, @Req() req: { user?: { userId: number } }) {
    this.uid(req);
    return this.registryService.login(dto.providerUrl, dto.username, dto.password);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout from a Docker registry' })
  async logout(@Body() dto: LogoutRegistryDto, @Req() req: { user?: { userId: number } }) {
    this.uid(req);
    return this.registryService.logout(dto.providerUrl);
  }

  @Post('verify-connection')
  @ApiOperation({ summary: 'Verify Docker registry credentials' })
  async verifyConnection(
    @Body() dto: VerifyRegistryConnectionDto,
    @Req() req: { user?: { userId: number } },
  ) {
    this.uid(req);
    return this.registryService.verifyConnection(
      dto.providerUrl,
      dto.username,
      dto.password,
    );
  }
}
