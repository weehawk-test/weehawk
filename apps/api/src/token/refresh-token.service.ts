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
    @InjectRepository(RefreshToken) private readonly repo: Repository<RefreshToken>,
    private readonly config: ConfigService,
  ) {}

  private allowMultipleDevices(): boolean {
    return this.config.get<string>('APP_AUTH_ALLOW_MULTIPLE_DEVICES', 'true') === 'true';
  }

  private refreshTokenSecret(): string {
    return (
      this.config.get<string>('REFRESH_TOKEN_HASH_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      'local-dev-refresh-token-secret'
    );
  }

  private hashToken(token: string): string {
    return crypto.createHmac('sha256', this.refreshTokenSecret()).update(token).digest('hex');
  }

  async createRefreshToken(user: User): Promise<string> {
    if (!this.allowMultipleDevices()) {
      await this.repo.delete({ userId: user.id });
    }
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
    const rawToken = crypto.randomUUID();
    const token = this.repo.create({
      tokenHash: this.hashToken(rawToken),
      user,
      userId: user.id,
      expiry,
      createdAt: new Date(),
    });
    await this.repo.save(token);
    return rawToken;
  }

  async validateRefreshToken(token: string): Promise<RefreshToken> {
    const tokenHash = this.hashToken(token);
    const rt = await this.repo.findOne({ where: { tokenHash }, relations: { user: true } });
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
    await this.repo.delete({ tokenHash: this.hashToken(token) });
  }

  isMultipleDevicesAllowed(): boolean {
    return this.allowMultipleDevices();
  }
}
