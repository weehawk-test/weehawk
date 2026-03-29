import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';


@ApiTags('Auth')
@Controller('/api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Get('/setup-status')
  async setupStatus(): Promise<{ needsSetup: boolean }> {
    return this.authService.getSetupStatus();
  }

  @Post('/register')
  @ApiBody({ type: RegisterDto })
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('/login')
  @ApiBody({ type: LoginDto })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Post('/refresh')
  @ApiBody({ type: RefreshTokenDto })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('/logout')
  @ApiBody({ type: RefreshTokenDto })
  async logout(@Body() dto: RefreshTokenDto & { email?: string }): Promise<{ message: string }> {
    await this.authService.logout(dto.refreshToken, dto.email);
    return { message: 'Logged out successfully' };
  }
}
