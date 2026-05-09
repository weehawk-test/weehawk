import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { AuthProvider } from './entities/auth-provider.enum';
import { Role } from './entities/role.enum';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenService } from '../token/refresh-token.service';
import { EmailConfirmationService } from '../email/email-confirmation.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type { Profile } from 'passport-google-oauth20';

function isPostgresUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const q = err as QueryFailedError & {
    code?: string;
    driverError?: { code?: string };
  };
  return q.code === '23505' || q.driverError?.code === '23505';
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  getRegistrationStatus(): Promise<{
    instanceMode: 'cloud' | 'self-hosted';
    userConfigured: boolean;
    registrationOpen: boolean;
  }> {
    return this.computeRegistrationStatus();
  }

  async assertRegistrationAllowed(): Promise<void> {
    const status = await this.computeRegistrationStatus();
    if (!status.registrationOpen) {
      throw new ForbiddenException('Registration is closed for this instance.');
    }
  }

  assertGoogleOauthAllowed(): void {
    const rawMode = this.config.get<string>('INSTANCE_MODE') ?? 'cloud';
    const normalized = rawMode.trim().toLowerCase();
    if (normalized === 'self-hosted') {
      throw new ForbiddenException(
        'Google OAuth is disabled for self-hosted instances.',
      );
    }
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const status = await this.computeRegistrationStatus();
    if (!status.registrationOpen) {
      throw new ForbiddenException('Registration is closed for this instance.');
    }
    if (
      await this.userRepo.exists({ where: { email: dto.email.toLowerCase() } })
    ) {
      throw new ConflictException('Email already in use: ' + dto.email);
    }
    const hash = await bcrypt.hash(dto.password, 10);
    const now = new Date();
    // In self-hosted, the very first account bootstraps the instance and gets ADMIN.
    const isFirstSelfHostedUser =
      status.instanceMode === 'self-hosted' && !status.userConfigured;
    const user = this.userRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email.toLowerCase(),
      passwordHash: hash,
      provider: AuthProvider.LOCAL,
      role: isFirstSelfHostedUser ? Role.ADMIN : Role.USER,
      enabled: true,
      emailVerified: isFirstSelfHostedUser,
      locked: false,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.userRepo.save(user);
    await this.emailConfirmationService
      .sendConfirmationEmail(saved)
      .catch(() => {});
    const accessToken = this.generateAccessToken(saved);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(saved);
    await this.organizationsService.ensureAtLeastOneOwnedOrganizationForUser(
      saved.id,
    );
    return this.buildAuthResponse(saved, accessToken, refreshToken);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const status = await this.computeRegistrationStatus();
    if (status.instanceMode === 'self-hosted' && !status.userConfigured) {
      throw new ForbiddenException(
        'Login is unavailable until the first account is created.',
      );
    }
    const user = await this.userRepo.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    if (!user.passwordHash) {
      throw new ConflictException(
        `Account is linked to ${user.provider}. Please sign in with that provider.`,
      );
    }
    if (user.locked)
      throw new ForbiddenException(
        'Account is locked. Please contact support.',
      );

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');

    user.lastLogin = new Date();
    await this.userRepo.save(user);

    const accessToken = this.generateAccessToken(user);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponseWithOrg(user, accessToken, refreshToken);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const rt =
      await this.refreshTokenService.validateRefreshToken(refreshToken);
    const user = rt.user;
    await this.refreshTokenService.deleteByToken(refreshToken);
    const accessToken = this.generateAccessToken(user);
    const newRt = await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponseWithOrg(user, accessToken, newRt);
  }

  async logout(email: string, refreshToken: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return;
    if (this.refreshTokenService.isMultipleDevicesAllowed()) {
      await this.refreshTokenService.deleteByToken(refreshToken);
    } else {
      await this.refreshTokenService.deleteByUserId(user.id);
    }
  }

  async changePassword(email: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'No password set. Please use reset password instead.',
      );
    }
    const match = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
  }

  async resendConfirmation(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerified)
      throw new ConflictException('Email already verified');
    await this.emailConfirmationService.sendConfirmationEmail(user);
  }

  createGoogleLinkIntentToken(userId: number): string {
    return this.jwtService.sign(
      { purpose: 'google_oauth_link', sub: String(userId) },
      { expiresIn: '10m' },
    );
  }

  verifyGoogleLinkIntentToken(token: string): number {
    try {
      const payload = this.jwtService.verify<{
        purpose?: string;
        sub?: string;
      }>(token);
      if (payload.purpose !== 'google_oauth_link' || !payload.sub) {
        throw new UnauthorizedException('Invalid link session');
      }
      const id = Number(payload.sub);
      if (!Number.isFinite(id) || id <= 0)
        throw new UnauthorizedException('Invalid link session');
      return id;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid or expired link session');
    }
  }

  async assertCanStartGoogleLink(userId: number): Promise<void> {
    this.assertGoogleOauthAllowed();
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.locked)
      throw new ForbiddenException(
        'Account is locked. Please contact support.',
      );
    if (user.providerId) {
      throw new ConflictException('Google is already linked to this account.');
    }
  }

  async linkGoogleAccount(
    userId: number,
    profile: Profile,
  ): Promise<AuthResponseDto> {
    this.assertGoogleOauthAllowed();
    const email = profile.emails?.[0]?.value?.toLowerCase()?.trim();
    if (!email)
      throw new UnauthorizedException('Google account email not available');

    const providerId = profile.id ? String(profile.id) : null;
    if (!providerId)
      throw new UnauthorizedException('Google account id not available');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.locked)
      throw new ForbiddenException(
        'Account is locked. Please contact support.',
      );
    if (user.providerId) {
      throw new ConflictException('Google is already linked to this account.');
    }
    if (!this.canSignInWithGoogle(user)) {
      throw new ConflictException(
        `Account is linked to ${user.provider}. Please sign in with that provider.`,
      );
    }

    const ownerOfProviderId = await this.userRepo.findOne({
      where: { providerId },
    });
    if (ownerOfProviderId && ownerOfProviderId.id !== userId) {
      throw new ConflictException(
        'This Google account is already linked to another user.',
      );
    }

    const ownerOfGoogleEmail = await this.userRepo.findOne({
      where: { email },
    });
    if (ownerOfGoogleEmail && ownerOfGoogleEmail.id !== userId) {
      throw new ConflictException(
        'An account with this Google email already exists. Sign in with Google or use a different Google account.',
      );
    }

    const givenName = profile.name?.givenName ?? '';
    const familyName = profile.name?.familyName ?? '';
    const imageUrl = profile.photos?.[0]?.value ?? null;

    let merged: User;
    try {
      merged = await this.mergeGoogleProfileIntoUser(user, {
        email,
        providerId,
        givenName,
        familyName,
        imageUrl,
      });
    } catch (e) {
      if (!isPostgresUniqueViolation(e)) throw e;
      throw new ConflictException(
        'This Google account is already linked to another user.',
      );
    }

    const accessToken = this.generateAccessToken(merged);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(merged);
    return this.buildAuthResponseWithOrg(merged, accessToken, refreshToken);
  }

  async loginWithGoogle(profile: Profile): Promise<AuthResponseDto> {
    this.assertGoogleOauthAllowed();
    const email = profile.emails?.[0]?.value?.toLowerCase()?.trim();
    if (!email)
      throw new UnauthorizedException('Google account email not available');

    const providerId = profile.id ? String(profile.id) : null;
    const givenName = profile.name?.givenName ?? '';
    const familyName = profile.name?.familyName ?? '';
    const imageUrl = profile.photos?.[0]?.value ?? null;

    let user =
      (await this.userRepo.findOne({ where: { email } })) ??
      (providerId
        ? await this.userRepo.findOne({ where: { providerId } })
        : null);

    if (user) {
      if (!this.canSignInWithGoogle(user)) {
        throw new ConflictException(
          `Account is linked to ${user.provider}. Please sign in with that provider.`,
        );
      }
      if (user.locked)
        throw new ForbiddenException(
          'Account is locked. Please contact support.',
        );
      user = await this.mergeGoogleProfileIntoUser(user, {
        email,
        providerId,
        givenName,
        familyName,
        imageUrl,
      });
    } else {
      const now = new Date();
      const candidate = this.userRepo.create({
        firstName: givenName || 'Google',
        lastName: familyName || 'User',
        email,
        googleAccountEmail: email,
        passwordHash: null,
        provider: AuthProvider.GOOGLE,
        providerId,
        role: Role.USER,
        enabled: true,
        emailVerified: true,
        locked: false,
        imageUrl,
        createdAt: now,
        updatedAt: now,
      });
      try {
        user = await this.userRepo.save(candidate);
      } catch (e) {
        if (!isPostgresUniqueViolation(e)) throw e;
        user =
          (await this.userRepo.findOne({ where: { email } })) ??
          (providerId
            ? await this.userRepo.findOne({ where: { providerId } })
            : null);
        if (!user) throw e;
        if (!this.canSignInWithGoogle(user)) {
          throw new ConflictException(
            `Account is linked to ${user.provider}. Please sign in with that provider.`,
          );
        }
        if (user.locked)
          throw new ForbiddenException(
            'Account is locked. Please contact support.',
          );
        user = await this.mergeGoogleProfileIntoUser(user, {
          email,
          providerId,
          givenName,
          familyName,
          imageUrl,
        });
      }
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponseWithOrg(user, accessToken, refreshToken);
  }

  private async mergeGoogleProfileIntoUser(
    user: User,
    p: {
      email: string;
      providerId: string | null;
      givenName: string;
      familyName: string;
      imageUrl: string | null;
    },
  ): Promise<User> {
    user.providerId = p.providerId ?? user.providerId;
    if (p.email) {
      user.googleAccountEmail = p.email;
    }
    if (p.imageUrl && !user.imageUrl) user.imageUrl = p.imageUrl;
    if (p.givenName && !user.firstName) user.firstName = p.givenName;
    if (p.familyName && !user.lastName) user.lastName = p.familyName;
    if (user.email.toLowerCase() === p.email.toLowerCase()) {
      user.emailVerified = true;
    }
    user.lastLogin = new Date();
    return this.userRepo.save(user);
  }

  private canSignInWithGoogle(user: User): boolean {
    return (
      user.provider === AuthProvider.GOOGLE ||
      user.provider === AuthProvider.LOCAL
    );
  }

  private generateAccessToken(user: User): string {
    return this.jwtService.sign(
      {
        sub: String(user.id),
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      { expiresIn: this.config.get('JWT_EXP', '7d') },
    );
  }

  private async buildAuthResponseWithOrg(
    user: User,
    accessToken: string,
    refreshToken: string,
  ): Promise<AuthResponseDto> {
    await this.organizationsService.ensureAtLeastOneOwnedOrganizationForUser(
      user.id,
    );
    return this.buildAuthResponse(user, accessToken, refreshToken);
  }

  private buildAuthResponse(
    user: User,
    accessToken: string,
    refreshToken: string,
  ): AuthResponseDto {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      provider: user.provider,
      imageUrl: user.imageUrl ?? null,
      emailVerified: user.emailVerified,
    };
  }

  private async computeRegistrationStatus(): Promise<{
    instanceMode: 'cloud' | 'self-hosted';
    userConfigured: boolean;
    registrationOpen: boolean;
  }> {
    const rawMode = this.config.get<string>('INSTANCE_MODE') ?? 'cloud';
    const normalized = rawMode.trim().toLowerCase();
    const instanceMode: 'cloud' | 'self-hosted' =
      normalized === 'self-hosted' ? 'self-hosted' : 'cloud';
    const userConfigured = await this.userRepo.exists({});
    return {
      instanceMode,
      userConfigured,
      registrationOpen: !(instanceMode === 'self-hosted' && userConfigured),
    };
  }
}
