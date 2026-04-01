import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { RefreshToken } from './refresh-token.entity';
import { UnauthorizedException } from '@nestjs/common';
import crypto from 'crypto';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
    private readonly config: ConfigService,
  ) {}

  private allowMultipleDevices(): boolean {
    return (
      this.config.get<string>('APP_AUTH_ALLOW_MULTIPLE_DEVICES', 'true') ===
      'true'
    );
  }

  async createRefreshToken(user: User): Promise<RefreshToken> {
    if (!this.allowMultipleDevices()) {
      await this.repo.delete({ userId: user.id });
    }
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
    const token = this.repo.create({
      token: crypto.randomUUID(),
      user,
      userId: user.id,
      expiry,
      createdAt: new Date(),
    });
    return this.repo.save(token);
  }

  async validateRefreshToken(token: string): Promise<RefreshToken> {
    const rt = await this.repo.findOne({
      where: { token },
      relations: { user: true },
    });
    if (!rt) throw new UnauthorizedException('Invalid refresh token');
    if (rt.isExpired()) {
      await this.repo.delete({ id: rt.id });
      throw new UnauthorizedException('Refresh token expired');
    }
    return rt;
  }

  async deleteByUserId(userId: number): Promise<void> {
    await this.repo.delete({ userId });
  }

  async deleteByToken(token: string): Promise<void> {
    await this.repo.delete({ token });
  }

  isMultipleDevicesAllowed(): boolean {
    return this.allowMultipleDevices();
  }
}
