import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import { LoginRegistryDto } from './dto/login-registry.dto';
import { LogoutRegistryDto } from './dto/logout-registry.dto';
import { VerifyRegistryConnectionDto } from './dto/verify-registry-connection.dto';

@ApiTags('Registry')
@Controller('api/registry')
export class RegistryController {
  constructor(private readonly registryService: RegistryService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login to a Docker registry' })
  async login(@Body() dto: LoginRegistryDto) {
    return this.registryService.login(dto.providerUrl, dto.username, dto.password);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout from a Docker registry' })
  async logout(@Body() dto: LogoutRegistryDto) {
    return this.registryService.logout(dto.providerUrl);
  }

  @Post('verify-connection')
  @ApiOperation({ summary: 'Verify Docker registry credentials' })
  async verifyConnection(@Body() dto: VerifyRegistryConnectionDto) {
    return this.registryService.verifyConnection(
      dto.providerUrl,
      dto.username,
      dto.password,
    );
  }
}
