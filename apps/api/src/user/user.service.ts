import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../auth/entities/user.entity';
import { AuthProvider } from '../auth/auth-provider.enum';
import { RefreshTokenService } from '../token/refresh-token.service';
import { EmailConfirmationService } from '../email/email-confirmation.service';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly emailConfirmationService: EmailConfirmationService,
  ) {}

  async getProfile(email: string): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return this.toProfileResponse(user);
  }

  async updateProfile(
    email: string,
    dto: UpdateProfileRequestDto,
  ): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    user.firstName = dto.firstName;
    user.lastName = dto.lastName;
    await this.userRepo.save(user);
    return this.toProfileResponse(user);
  }

  async changePassword(
    email: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.authProvider !== AuthProvider.LOCAL || user.passwordHash == null) {
      throw new BadRequestException(
        'This account does not use a password. Use Google sign-in or reset password from the login page.',
      );
    }
    const match = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!match) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from your current password.',
      );
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
    await this.refreshTokenService.deleteByUserId(user.id);
    return {
      message:
        'Password updated. Other sessions were signed out; sign in again if needed.',
    };
  }

  async resendConfirmationEmail(
    email: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.authProvider !== AuthProvider.LOCAL) {
      throw new BadRequestException(
        'Email confirmation applies to password accounts only.',
      );
    }
    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified.');
    }
    await this.emailConfirmationService.sendConfirmationEmail(user);
    return { message: 'Confirmation email sent.' };
  }

  async deleteAccount(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    await this.refreshTokenService.deleteByUserId(user.id);
    await this.userRepo.remove(user);
  }

  toProfileResponse(user: User): UserProfileResponseDto {
    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      imageUrl: user.imageUrl ?? null,
      emailVerified: user.emailVerified,
      authProvider: user.authProvider,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin ?? null,
    };
  }
}
