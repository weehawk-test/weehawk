import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../auth/entities/user.entity';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UpdateProfileRequestDto } from '../auth/dto/update-profile-request.dto';
import { AuthProvider } from '../auth/entities/auth-provider.enum';
import { Webhook } from '../webhooks/entities/webhook.entity';
import { CronJob } from '../cron-jobs/entities/cron-job.entity';
import { Project } from '../projects/entities/project.entity';
import { RemoteServerProvisionJob } from '../remote-servers/entities/remote-server-provision-job.entity';
import { RemoteServer } from '../remote-servers/entities/remote-server.entity';
import { S3Profile } from '../s3/entities/s3-profile.entity';
import { NotificationChannel } from '../notifications/entities/notification-channel.entity';
import { RefreshToken } from '../token/refresh-token.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
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
   * Removes all rows scoped to this user (projects, services via FK cascade, integrations, etc.)
   * then deletes the user. Used for self-service account deletion and admin delete.
   */
  async deleteUserAndRelatedRows(userId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.deleteUserScopedData(manager, userId);
      await manager.delete(User, { id: userId });
    });
  }

  private async deleteUserScopedData(
    manager: EntityManager,
    userId: number,
  ): Promise<void> {
    await manager.delete(Webhook, { userId });
    await manager.delete(CronJob, { userId });
    await manager.delete(Project, { userId });
    await manager.delete(RemoteServerProvisionJob, { userId });
    await manager.delete(RemoteServer, { userId });
    await manager.delete(S3Profile, { userId });
    await manager.delete(NotificationChannel, { userId });
    await manager.delete(RefreshToken, { userId });
  }

  async deleteAccount(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
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
