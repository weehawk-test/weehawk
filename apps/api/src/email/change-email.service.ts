import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { EmailService } from './email.service';
import { TokenStoreService } from './token-store.service';
import { RefreshTokenService } from '../token/refresh-token.service';

const PREFIX = 'email-change:';
const SEPARATOR = '||';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class ChangeEmailService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly emailService: EmailService,
    private readonly tokenStore: TokenStoreService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly config: ConfigService,
  ) {}

  getBaseUrl(): string {
    return this.config.get<string>('app.baseUrl') ?? 'http://localhost:8080';
  }

  getFrontendBaseUrl(): string {
    return (this.config.get<string>('WEBFRONTEND_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  async requestEmailChange(currentEmail: string, newEmail: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email: currentEmail } });
    if (!user) throw new NotFoundException('User not found');
    if (await this.userRepo.exists({ where: { email: newEmail.toLowerCase() } })) {
      throw new ConflictException('Email already in use');
    }
    this.tokenStore.delete(PREFIX + user.id);
    const token = crypto.randomUUID();
    this.tokenStore.set(PREFIX + token, currentEmail + SEPARATOR + newEmail.toLowerCase(), TTL_MS);
    const link = `${this.getFrontendBaseUrl()}/confirm-email-change?token=${token}`;
    await this.emailService.sendEmailChangeConfirmation(newEmail, user.firstName, link);
    if (user.emailVerified) {
      await this.emailService.sendEmailChangeNotification(currentEmail, user.firstName);
    }
  }

  async confirmEmailChange(token: string): Promise<void> {
    const value = this.tokenStore.get(PREFIX + token);
    if (!value) throw new NotFoundException('Invalid or expired token');
    const [currentEmail, newEmail] = value.split(SEPARATOR);
    const user = await this.userRepo.findOne({ where: { email: currentEmail } });
    if (!user) throw new NotFoundException('User not found');
    const wasVerified = user.emailVerified;
    user.email = newEmail;
    user.emailVerified = true;
    await this.userRepo.save(user);
    await this.refreshTokenService.deleteByUserId(user.id);
    if (wasVerified) {
      await this.emailService.sendEmailChangedConfirmation(currentEmail, user.firstName);
    }
    this.tokenStore.delete(PREFIX + token);
  }
}
