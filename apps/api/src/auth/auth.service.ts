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
import { RefreshTokenService } from '../token/refresh-token.service';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async getSetupStatus(): Promise<{ needsSetup: boolean }> {
    const count = await this.userRepo.count();
    return { needsSetup: count === 0 };
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if ((await this.userRepo.count()) > 0) {
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

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');

    user.lastLogin = new Date();
    await this.userRepo.save(user);

    const accessToken = this.generateAccessToken(user);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(user);
    return this.buildAuthResponse(user, accessToken, refreshToken.token);
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
      imageUrl: null,
    };
  }
}
