import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('User')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('/api/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

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
}
