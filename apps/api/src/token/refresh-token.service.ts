import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { RefreshToken } from './refresh-token.entity';
import crypto from 'crypto';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const RAW_TOKEN_BYTES = 32;

export type CreatedRefreshToken = { rawToken: string };

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

  /** Hash for storage / lookup. Optional `REFRESH_TOKEN_PEPPER` hardens against DB-only leaks. */
  private hashRawToken(raw: string): string {
    const pepper = this.config.get<string>('REFRESH_TOKEN_PEPPER') ?? '';
    return crypto
      .createHash('sha256')
      .update(pepper, 'utf8')
      .update(raw, 'utf8')
      .digest('hex');
  }

  async createRefreshToken(user: User): Promise<CreatedRefreshToken> {
    if (!this.allowMultipleDevices()) {
      await this.repo.delete({ userId: user.id });
    }
    const rawToken = crypto.randomBytes(RAW_TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashRawToken(rawToken);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
    const row = this.repo.create({
      tokenHash,
      user,
      userId: user.id,
      expiry,
      createdAt: new Date(),
    });
    await this.repo.save(row);
    return { rawToken };
  }

  async validateRefreshToken(rawToken: string): Promise<RefreshToken> {
    if (!rawToken?.trim()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const tokenHash = this.hashRawToken(rawToken);
    const rt = await this.repo.findOne({
      where: { tokenHash },
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

  async deleteById(id: number): Promise<void> {
    await this.repo.delete({ id });
  }

  async deleteByToken(rawToken: string): Promise<void> {
    if (!rawToken?.trim()) return;
    const tokenHash = this.hashRawToken(rawToken);
    await this.repo.delete({ tokenHash });
  }

  isMultipleDevicesAllowed(): boolean {
    return this.allowMultipleDevices();
  }
}
