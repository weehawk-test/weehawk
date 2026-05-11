import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.enum';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { AuthProvider } from '../auth/entities/auth-provider.enum';
import { RemoteServerProvisionJob } from '../remote-servers/entities/remote-server-provision-job.entity';
import { RefreshToken } from '../token/refresh-token.entity';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly organizationsService: OrganizationsService,
    private readonly config: ConfigService,
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

  /**
   * Removes legacy per-user rows (provision jobs, refresh tokens, etc.),
   * then deletes the user. Organization-owned resources (projects, remote servers, S3 profiles, webhooks, …) are not deleted here.
   */
  async deleteUserAndRelatedRows(userId: number): Promise<void> {
    await this.organizationsService.removeUserFromAllOrganizationsForAccountDeletion(
      userId,
    );
    await this.dataSource.transaction(async (manager) => {
      await this.deleteUserScopedData(manager, userId);
      await manager.delete(User, { id: userId });
    });
  }

  private async deleteUserScopedData(
    manager: EntityManager,
    userId: number,
  ): Promise<void> {
    await manager.delete(RemoteServerProvisionJob, { userId });
    await manager.delete(RefreshToken, { userId });
  }

  async deleteAccount(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const rawMode = this.config.get<string>('INSTANCE_MODE') ?? 'cloud';
    const isSelfHosted = rawMode.trim().toLowerCase() === 'self-hosted';
    if (isSelfHosted && user.role === Role.ADMIN) {
      throw new ForbiddenException(
        'The instance administrator account cannot be deleted in self-hosted mode.',
      );
    }

    await this.deleteUserAndRelatedRows(user.id);
  }

  async setPasswordForGoogle(
    email: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.provider !== AuthProvider.GOOGLE) {
      throw new ConflictException(
        'This action is only available for Google accounts',
      );
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
      throw new ConflictException(
        'Set a password first before unlinking Google',
      );
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
