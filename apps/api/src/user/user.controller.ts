import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChangeEmailService } from '../email/change-email.service';

@ApiTags('User')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('/api/user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly changeEmailService: ChangeEmailService,
    private readonly config: ConfigService,
  ) {}

  @Get('/profile')
  getProfile(
    @Req() req: { user?: { email: string } },
  ): Promise<UserProfileResponseDto> {
    const email = req.user?.email;
    if (!email) throw new UnauthorizedException();
    return this.userService.getProfile(email);
  }

  @Put('/profile')
  updateProfile(
    @Req() req: { user?: { email: string } },
    @Body() dto: UpdateProfileRequestDto,
  ): Promise<UserProfileResponseDto> {
    const email = req.user?.email;
    if (!email) throw new UnauthorizedException();
    return this.userService.updateProfile(email, dto);
  }

  @Put('/password')
  @ApiBody({ type: ChangePasswordDto })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  changePassword(
    @Req() req: { user?: { email: string } },
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const email = req.user?.email;
    if (!email) throw new UnauthorizedException();
    return this.userService.changePassword(email, dto);
  }

  @Post('/email/change-request')
  @ApiBody({ type: RequestEmailChangeDto })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async requestEmailChange(
    @Req() req: { user?: { email: string } },
    @Body() dto: RequestEmailChangeDto,
  ): Promise<{ message: string }> {
    const edition = (
      this.config.get<string>('WEEHAWK_EDITION') ?? 'selfhosted'
    )
      .trim()
      .toLowerCase();
    if (edition !== 'cloud') {
      throw new ForbiddenException(
        'Email change is only available in cloud edition.',
      );
    }
    const email = req.user?.email;
    if (!email) throw new UnauthorizedException();
    await this.changeEmailService.requestEmailChange(email, dto.newEmail);
    return {
      message:
        'Check the new inbox for a confirmation link (and your current email for a security notice if applicable).',
    };
  }

  @Post('/email/resend-confirmation')
  resendConfirmation(
    @Req() req: { user?: { email: string } },
  ): Promise<{ message: string }> {
    const email = req.user?.email;
    if (!email) throw new UnauthorizedException();
    return this.userService.resendConfirmationEmail(email);
  }
}
