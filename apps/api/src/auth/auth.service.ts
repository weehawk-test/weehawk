import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import type { Profile } from 'passport-google-oauth20';
import { User } from './entities/user.entity';
import { RefreshTokenService } from '../token/refresh-token.service';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { AuthProvider } from './auth-provider.enum';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  /** `cloud` = multi-tenant style open registration; default `selfhosted` = first user only. */
  private isCloudEdition(): boolean {
    const raw = (this.config.get<string>('WEEHAWK_EDITION') ?? 'selfhosted')
      .trim()
      .toLowerCase();
    return raw === 'cloud';
  }

  async getSetupStatus(): Promise<{
    edition: 'cloud' | 'selfhosted';
    needsSetup: boolean;
    hasUsers: boolean;
  }> {
    const count = await this.userRepo.count();
    const cloud = this.isCloudEdition();
    return {
      edition: cloud ? 'cloud' : 'selfhosted',
      needsSetup: !cloud && count === 0,
      hasUsers: count > 0,
    };
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if (!this.isCloudEdition() && (await this.userRepo.count()) > 0) {
      throw new ForbiddenException(
        'Registration is only allowed for the first account. Please sign in.',
      );
    }
    if (
      await this.userRepo.exists({ where: { email: dto.email.toLowerCase() } })
    ) {
      throw new ConflictException('Email already in use: ' + dto.email);
    }
    const hash = await bcrypt.hash(dto.password, 10);
    const now = new Date();
    const user = this.userRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email.toLowerCase(),
      passwordHash: hash,
      authProvider: AuthProvider.LOCAL,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.userRepo.save(user);
    const accessToken = this.generateAccessToken(saved);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(saved);
    return this.buildAuthResponse(saved, accessToken, refreshToken.token);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    if (user.passwordHash == null) {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Please continue with Google.',
      );
    }

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');

    user.lastLogin = new Date();
    await this.userRepo.save(user);

    const accessToken = this.generateAccessToken(user);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponse(user, accessToken, refreshToken.token);
  }

  async loginWithGoogle(profile: Profile): Promise<{
    auth: AuthResponseDto;
    isNewUser: boolean;
  }> {
    if (!this.isCloudEdition()) {
      throw new ForbiddenException(
        'Google sign-in is only available in cloud edition.',
      );
    }
    const googleId = profile.id;
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!googleId || !email) {
      throw new UnauthorizedException(
        'Google did not return a valid account id and email.',
      );
    }
    const firstName =
      profile.name?.givenName?.trim() ||
      profile.displayName?.split(/\s+/)[0]?.trim() ||
      'User';
    const lastName = profile.name?.familyName?.trim() ?? '';
    const imageUrl = profile.photos?.[0]?.value?.trim() ?? null;

    const existing =
      (await this.userRepo.findOne({ where: { googleId } })) ??
      (await this.userRepo.findOne({ where: { email } }));
    const isNewUser = !existing;
    let user = existing;

    const now = new Date();
    if (user) {
      if (!user.googleId) user.googleId = googleId;
      user.authProvider = AuthProvider.GOOGLE;
      // Do not sync name/avatar from Google on every login — user may have edited profile locally.
      user.lastLogin = now;
      user.updatedAt = now;
      await this.userRepo.save(user);
    } else {
      user = this.userRepo.create({
        firstName,
        lastName,
        email,
        passwordHash: null,
        authProvider: AuthProvider.GOOGLE,
        googleId,
        imageUrl,
        createdAt: now,
        updatedAt: now,
        lastLogin: now,
      });
      await this.userRepo.save(user);
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(user);
    return {
      auth: this.buildAuthResponse(user, accessToken, refreshToken.token),
      isNewUser,
    };
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const rt =
      await this.refreshTokenService.validateRefreshToken(refreshToken);
    const user = rt.user;
    const accessToken = this.generateAccessToken(user);
    const newRt = await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponse(user, accessToken, newRt.token);
  }

  async logout(refreshToken: string, email?: string): Promise<void> {
    if (email) {
      const user = await this.userRepo.findOne({
        where: { email: email.toLowerCase() },
      });
      if (user) {
        if (this.refreshTokenService.isMultipleDevicesAllowed()) {
          await this.refreshTokenService.deleteByToken(refreshToken);
        } else {
          await this.refreshTokenService.deleteByUserId(user.id);
        }
        return;
      }
    }
    await this.refreshTokenService.deleteByToken(refreshToken);
  }

  private generateAccessToken(user: User): string {
    return this.jwtService.sign(
      { sub: user.email, email: user.email },
      { expiresIn: this.config.get('JWT_EXP', '7d') },
    );
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
      imageUrl: user.imageUrl ?? null,
      role: 'USER',
      provider: user.authProvider ?? AuthProvider.LOCAL,
    };
  }
}
