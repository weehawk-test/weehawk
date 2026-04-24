import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

export interface EmailRequestDto {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async send(request: EmailRequestDto): Promise<void> {
    const enabledRaw = this.config.get<string>('MAIL_ENABLED');
    const enabled =
      enabledRaw != null
        ? !['false', '0', 'off', 'no'].includes(enabledRaw.toLowerCase().trim())
        : this.config.get<boolean>('mail.enabled', true);
    if (!enabled) {
      const env = this.config.get<string>('app.env', 'development');
      if (env !== 'production') {
        const logBodyRaw = this.config.get<string>('MAIL_LOG_BODY');
        const logBody =
          logBodyRaw != null
            ? ['true', '1', 'on', 'yes'].includes(logBodyRaw.toLowerCase().trim())
            : this.config.get<boolean>('mail.logBody', false);
        this.logger.debug(
          `MAIL_DISABLED: MAIL_ENABLED="${enabledRaw ?? 'undefined'}"; skipped email to="${request.to}" subject="${request.subject}" (${request.isHtml ? 'html' : 'text'})`,
        );
        if (logBody) {
          this.logger.debug(
            `MAIL_DISABLED (preview)\nTO: ${request.to}\nSUBJECT: ${request.subject}\nTYPE: ${
              request.isHtml ? 'html' : 'text'
            }\nBODY:\n${request.body}\n--- end ---`,
          );
        }
      }
      return;
    }

    let result: unknown;
    try {
      result = await this.mailer.sendMail({
        to: request.to,
        subject: request.subject,
        ...(request.isHtml ? { html: request.body } : { text: request.body }),
      });
    } catch (error) {
      const err = error as { code?: string; response?: string; message?: string };
      this.logger.error(
        `MAIL_SEND_FAILED: to="${request.to}" subject="${request.subject}" code="${err?.code ?? 'unknown'}" message="${err?.message ?? 'unknown'}"${err?.response ? ` response="${err.response}"` : ''}`,
      );
      throw error;
    }
    const env = this.config.get<string>('app.env', 'development');
    if (env !== 'production') {
      const messageId = (result as any)?.messageId;
      this.logger.debug(
        `MAIL_SENT: to="${request.to}" subject="${request.subject}"${messageId ? ` messageId="${String(messageId)}"` : ''}`,
      );
    }
  }

  async sendText(to: string, subject: string, body: string): Promise<void> {
    await this.send({ to, subject, body, isHtml: false });
  }

  async sendHtml(to: string, subject: string, htmlBody: string): Promise<void> {
    await this.send({ to, subject, body: htmlBody, isHtml: true });
  }

  async sendEmailConfirmation(to: string, firstName: string, confirmationLink: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2>Hello ${firstName}!</h2>
        <p>Click the button below to confirm your email address:</p>
        <a href="${confirmationLink}" style="
          background-color: #4CAF50;
          color: white;
          padding: 14px 20px;
          text-decoration: none;
          border-radius: 4px;
          display: inline-block;">
          Confirm Email
        </a>
        <p style="color: #888; margin-top: 20px;">This link is valid for 24 hours only.</p>
      </div>`;
    await this.sendHtml(to, 'Confirm Your Email Address', html);
  }

  async sendPasswordReset(to: string, firstName: string, resetLink: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2>Hello ${firstName}!</h2>
        <p>You requested a password reset. Click the button below:</p>
        <a href="${resetLink}" style="
          background-color: #e53935;
          color: white;
          padding: 14px 20px;
          text-decoration: none;
          border-radius: 4px;
          display: inline-block;">
          Reset Password
        </a>
        <p style="color: #888; margin-top: 20px;">
          This link is valid for 1 hour only.
          If you did not request this, please ignore this email.
        </p>
      </div>`;
    await this.sendHtml(to, 'Reset Your Password', html);
  }

  async sendEmailChangeConfirmation(
    to: string,
    firstName: string,
    confirmationLink: string,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello ${firstName}!</h2>
        <p>You requested to change your email address. Click the button to confirm:</p>
        <a href="${confirmationLink}" style="background-color: #4CAF50; color: white; padding: 14px 20px;
          text-decoration: none; border-radius: 4px;">
          Confirm New Email
        </a>
        <p>This link is valid for 24 hours only.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>`;
    await this.sendHtml(to, 'Confirm your new email', html);
  }

  async sendEmailChangeNotification(to: string, firstName: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello ${firstName}!</h2>
        <p>A request was made to change your account email address.</p>
        <p style="color: red;">If this was not you, please contact support immediately.</p>
      </div>`;
    await this.sendHtml(to, 'Security Alert: Email Change Requested', html);
  }

  async sendEmailChangedConfirmation(to: string, firstName: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello ${firstName}!</h2>
        <p>Your account email address was changed successfully.</p>
        <p style="color: red;">If this was not you, please contact support immediately.</p>
      </div>`;
    await this.sendHtml(to, 'Your email has been changed', html);
  }
}
