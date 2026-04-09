import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from './dto/update-profile-request.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LocalSessionGuard } from '../common/guards/local-session.guard';

@ApiTags('User')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('/api/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('/profile')
  getProfile(): UserProfileResponseDto {
    return {
      firstName: 'Desktop',
      lastName: 'User',
      email: 'desktop@local.weehawk',
      imageUrl: null,
      emailVerified: true,
      createdAt: new Date(),
      lastLogin: null,
    };
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

}
