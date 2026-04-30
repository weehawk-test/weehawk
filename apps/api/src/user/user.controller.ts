import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { ChangeEmailRequestDto } from '../auth/dto/change-email-request.dto';
import { SetPasswordDto } from '../auth/dto/set-password.dto';
import { ChangeEmailService } from '../email/change-email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('User')
@Controller('/api/user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly changeEmailService: ChangeEmailService,
  ) {}

  @Get('/profile')
  getProfile(
    @Req() req: { user?: { email: string } },
  ): Promise<UserProfileResponseDto> {
    const email = req.user?.email;
    if (!email) throw new Error('User email missing');
    return this.userService.getProfile(email);
  }

  @Put('/profile')
  @ApiBody({ type: UpdateProfileRequestDto })
  updateProfile(
    @Req() req: { user?: { email: string } },
    @Body() dto: UpdateProfileRequestDto,
  ): Promise<UserProfileResponseDto> {
    const email = req.user?.email;
    if (!email) throw new Error('User email missing');
    return this.userService.updateProfile(email, dto);
  }

  @Delete('/account')
  async deleteAccount(
    @Req() req: { user?: { email: string } },
  ): Promise<{ message: string }> {
    const email = req.user?.email;
    if (!email) throw new Error('User email missing');
    await this.userService.deleteAccount(email);
    return { message: 'Account deleted successfully' };
  }

  @Put('/change-email')
  @ApiBody({ type: ChangeEmailRequestDto })
  async changeEmail(
    @Req() req: { user?: { email: string } },
    @Body() dto: ChangeEmailRequestDto,
  ): Promise<{ message: string }> {
    const email = req.user?.email;
    if (!email) throw new Error('User email missing');
    await this.changeEmailService.requestEmailChange(email, dto.newEmail);
    return { message: 'Confirmation email sent to your new email' };
  }

  @Post('/set-password')
  @ApiBody({ type: SetPasswordDto })
  async setPassword(
    @Req() req: { user?: { email: string } },
    @Body() dto: SetPasswordDto,
  ): Promise<{ message: string }> {
    const email = req.user?.email;
    if (!email) throw new Error('User email missing');
    await this.userService.setPasswordForGoogle(email, dto.newPassword);
    return { message: 'Password set successfully' };
  }

  @Delete('/unlink-google')
  async unlinkGoogle(
    @Req() req: { user?: { email: string } },
  ): Promise<{ message: string }> {
    const email = req.user?.email;
    if (!email) throw new Error('User email missing');
    await this.userService.unlinkGoogle(email);
    return { message: 'Google account unlinked successfully' };
  }
}
