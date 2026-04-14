import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { RefreshTokenService } from '../token/refresh-token.service';

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

  toProfileResponse(user: User): UserProfileResponseDto {
    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      provider: user.provider,
      imageUrl: user.imageUrl ?? null,
      emailVerified: user.emailVerified,
      enabled: user.enabled,
      locked: user.locked,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin ?? null,
    };
  }
}
