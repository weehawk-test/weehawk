import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { TokenModule } from '../token/token.module';
import { EmailService } from './email.service';
import { TokenStoreService } from './token-store.service';
import { EmailConfirmationService } from './email-confirmation.service';
import { PasswordResetService } from './password-reset.service';
import { ChangeEmailService } from './change-email.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([User]), TokenModule],
  providers: [
    EmailService,
    TokenStoreService,
    EmailConfirmationService,
    PasswordResetService,
    ChangeEmailService,
  ],
  exports: [
    EmailService,
    TokenStoreService,
    EmailConfirmationService,
    PasswordResetService,
    ChangeEmailService,
  ],
})
export class EmailModule {}
