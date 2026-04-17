import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../auth/entities/user.entity';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { RefreshTokenService } from '../token/refresh-token.service';
import { AuthProvider } from '../auth/entities/auth-provider.enum';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async getProfile(email: string): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return this.toProfileResponse(user);
  }

  async updateProfile(email: string, dto: UpdateProfileRequestDto): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    user.firstName = dto.firstName;
    user.lastName = dto.lastName;
    await this.userRepo.save(user);
    return this.toProfileResponse(user);
  }

  async deleteAccount(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    await this.refreshTokenService.deleteByUserId(user.id);
    await this.userRepo.remove(user);
  }

  async setPasswordForGoogle(email: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.provider !== AuthProvider.GOOGLE) {
      throw new ConflictException('This action is only available for Google accounts');
    }
    if (user.passwordHash) {
      throw new ConflictException('Password is already set for this account');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);
  }

  async unlinkGoogle(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.provider !== AuthProvider.GOOGLE && !user.providerId) {
      throw new ConflictException('Account is not linked to Google');
    }
    if (!user.passwordHash) {
      throw new ConflictException('Set a password first before unlinking Google');
    }
    user.provider = AuthProvider.LOCAL;
    user.providerId = null;
    user.googleAccountEmail = null;
    await this.userRepo.save(user);
  }

  toProfileResponse(user: User): UserProfileResponseDto {
    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      provider: user.provider,
      providerId: user.providerId,
      googleAccountEmail: user.googleAccountEmail,
      imageUrl: user.imageUrl ?? null,
      hasPassword: Boolean(user.passwordHash),
      emailVerified: user.emailVerified,
      enabled: user.enabled,
      locked: user.locked,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin ?? null,
    };
  }
}
