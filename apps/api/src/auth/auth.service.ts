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
import { Repository } from 'typeorm';
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
import type { Profile } from 'passport-google-oauth20';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly emailConfirmationService: EmailConfirmationService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if (await this.userRepo.exists({ where: { email: dto.email.toLowerCase() } })) {
      throw new ConflictException('Email already in use: ' + dto.email);
    }
    const hash = await bcrypt.hash(dto.password, 10);
    const now = new Date();
    const user = this.userRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email.toLowerCase(),
      passwordHash: hash,
      provider: AuthProvider.LOCAL,
      role: Role.USER,
      enabled: true,
      emailVerified: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.userRepo.save(user);
    await this.emailConfirmationService.sendConfirmationEmail(saved).catch(() => {});
    const accessToken = this.generateAccessToken(saved);
    const refreshToken = await this.refreshTokenService.createRefreshToken(saved);
    return this.buildAuthResponse(saved, accessToken, refreshToken.token);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    if (user.provider !== AuthProvider.LOCAL || !user.passwordHash) {
      throw new ConflictException(
        `Account is linked to ${user.provider}. Please sign in with that provider.`,
      );
    }
    if (user.locked) throw new ForbiddenException('Account is locked. Please contact support.');

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');

    user.lastLogin = new Date();
    await this.userRepo.save(user);

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponse(user, accessToken, refreshToken.token);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const rt = await this.refreshTokenService.validateRefreshToken(refreshToken);
    const user = rt.user;
    const accessToken = this.generateAccessToken(user);
    const newRt = await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponse(user, accessToken, newRt.token);
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
      throw new UnauthorizedException('No password set. Please use reset password instead.');
    }
    const match = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
  }

  async resendConfirmation(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerified) throw new ConflictException('Email already verified');
    await this.emailConfirmationService.sendConfirmationEmail(user);
  }

  async loginWithGoogle(profile: Profile): Promise<AuthResponseDto> {
    const email = profile.emails?.[0]?.value?.toLowerCase()?.trim();
    if (!email) throw new UnauthorizedException('Google account email not available');

    const providerId = profile.id ? String(profile.id) : null;
    const givenName = profile.name?.givenName ?? '';
    const familyName = profile.name?.familyName ?? '';
    const imageUrl = profile.photos?.[0]?.value ?? null;

    let user = await this.userRepo.findOne({ where: { email } });
    if (user) {
      if (user.provider !== AuthProvider.GOOGLE) {
        throw new ConflictException(
          `Account is linked to ${user.provider}. Please sign in with that provider.`,
        );
      }
      if (user.locked) throw new ForbiddenException('Account is locked. Please contact support.');

      user.providerId = providerId ?? user.providerId;
      if (imageUrl && !user.imageUrl) user.imageUrl = imageUrl;
      if (givenName && !user.firstName) user.firstName = givenName;
      if (familyName && !user.lastName) user.lastName = familyName;
      user.emailVerified = true;
      user.lastLogin = new Date();
      user = await this.userRepo.save(user);
    } else {
      const now = new Date();
      user = this.userRepo.create({
        firstName: givenName || 'Google',
        lastName: familyName || 'User',
        email,
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
      user = await this.userRepo.save(user);
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponse(user, accessToken, refreshToken.token);
  }

  private generateAccessToken(user: User): string {
    return this.jwtService.sign(
      { sub: String(user.id), userId: user.id, email: user.email, role: user.role },
      { expiresIn: this.config.get('JWT_EXP', '7d') },
    );
  }

  private buildAuthResponse(user: User, accessToken: string, refreshToken: string): AuthResponseDto {
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
    };
  }
}
