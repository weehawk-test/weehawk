import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailerModule } from '@nestjs-modules/mailer';
import { User } from '../auth/entities/user.entity';
import { TokenModule } from '../token/token.module';
import { EmailService } from './email.service';
import { TokenStoreService } from './token-store.service';
import { EmailConfirmationService } from './email-confirmation.service';
import { PasswordResetService } from './password-reset.service';
import { ChangeEmailService } from './change-email.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    TokenModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pickNonEmpty = (...values: Array<string | number | undefined | null>): string | undefined => {
          for (const value of values) {
            if (value == null) continue;
            const text = String(value).trim();
            if (text) return text;
          }
          return undefined;
        };

        const host = pickNonEmpty(config.get<string>('MAIL_HOST'), config.get<string>('mail.host'), 'localhost');
        const port = Number(pickNonEmpty(config.get<string>('MAIL_PORT'), config.get<number>('mail.port'), '1025'));
        const user = pickNonEmpty(config.get<string>('MAIL_USER'), config.get<string>('mail.user'));
        const pass = pickNonEmpty(
          config.get<string>('MAIL_PASS'),
          config.get<string>('MAIL_PASSWORD'),
          config.get<string>('mail.pass'),
        );
        const from = pickNonEmpty(config.get<string>('MAIL_FROM'), config.get<string>('mail.from'));
        const fromEmail = pickNonEmpty(
          config.get<string>('MAIL_FROM_EMAIL'),
          config.get<string>('mail.fromEmail'),
          'noreply@localhost',
        );
        const fromName = pickNonEmpty(
          config.get<string>('MAIL_FROM_NAME'),
          config.get<string>('mail.fromName'),
          'weehawk',
        );
        return {
          transport: {
            host,
            port,
            secure: port === 465,
            ...(user && pass ? { auth: { user, pass } } : {}),
          },
          defaults: {
            from: from ?? `"${fromName}" <${fromEmail}>`,
          },
        };
      },
    }),
  ],
  providers: [
    EmailService,
    TokenStoreService,
    EmailConfirmationService,
    PasswordResetService,
    ChangeEmailService,
  ],
  exports: [
    EmailService,
    EmailConfirmationService,
    PasswordResetService,
    ChangeEmailService,
  ],
})
export class EmailModule {}

