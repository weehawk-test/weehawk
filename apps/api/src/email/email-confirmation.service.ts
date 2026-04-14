import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { EmailService } from './email.service';
import { TokenStoreService } from './token-store.service';

const PREFIX = 'email-confirm:';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class EmailConfirmationService {
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

  async sendConfirmationEmail(user: User): Promise<void> {
    this.tokenStore.delete(PREFIX + user.id);
    const token = crypto.randomUUID();
    this.tokenStore.set(PREFIX + token, String(user.id), TTL_MS);
    const link = `${this.getFrontendBaseUrl()}/confirm-email?token=${token}`;
    await this.emailService.sendEmailConfirmation(user.email, user.firstName, link);
  }

  async confirmEmail(token: string): Promise<void> {
    const userId = this.tokenStore.get(PREFIX + token);
    if (!userId) throw new NotFoundException('Invalid or expired confirmation token');
    const user = await this.userRepo.findOne({ where: { id: parseInt(userId, 10) } });
    if (!user) throw new NotFoundException('User not found');
    user.emailVerified = true;
    await this.userRepo.save(user);
    this.tokenStore.delete(PREFIX + token);
  }
}
