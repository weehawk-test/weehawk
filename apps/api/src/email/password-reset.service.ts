import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../auth/entities/user.entity';
import { EmailService } from './email.service';
import { TokenStoreService } from './token-store.service';

const PREFIX = 'password-reset:';
const TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly emailService: EmailService,
    private readonly tokenStore: TokenStoreService,
    private readonly config: ConfigService,
  ) {}

  getBaseUrl(): string {
    return this.config.get<string>('app.baseUrl') ?? 'http://localhost:8080';
  }

  getFrontendBaseUrl(): string {
    return (this.config.get<string>('WEBFRONTEND_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  async sendResetPasswordEmail(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');
    this.tokenStore.delete(PREFIX + user.id);
    const token = crypto.randomUUID();
    this.tokenStore.set(PREFIX + token, String(user.id), TTL_MS);
    const link = `${this.getFrontendBaseUrl()}/reset-password?token=${token}`;
    await this.emailService.sendPasswordReset(user.email, user.firstName, link);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = this.tokenStore.get(PREFIX + token);
    if (!userId) throw new NotFoundException('Invalid or expired reset token');
    const user = await this.userRepo.findOne({ where: { id: parseInt(userId, 10) } });
    if (!user) throw new NotFoundException('User not found');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);
    this.tokenStore.delete(PREFIX + token);
  }
}
