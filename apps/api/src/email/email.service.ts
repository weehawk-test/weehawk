import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailRequestDto {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter!: Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('MAIL_HOST', 'localhost');
    const port = parseInt(
      String(this.config.get<string>('MAIL_PORT') ?? '1025'),
      10,
    );
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASS');
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async send(request: EmailRequestDto): Promise<void> {
    const enabled = this.config.get<string>('MAIL_ENABLED', 'true') === 'true';
    if (!enabled) {
      const env = this.config.get<string>('NODE_ENV', 'development');
      if (env !== 'production') {
        const logBody = this.config.get<string>('MAIL_LOG_BODY', 'false') === 'true';
        this.logger.debug(
          `MAIL_DISABLED: skipped email to="${request.to}" subject="${request.subject}" (${request.isHtml ? 'html' : 'text'})`,
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

    const fromEmail = this.config.get<string>(
      'MAIL_FROM_EMAIL',
      'noreply@localhost',
    );
    const fromName = this.config.get<string>('MAIL_FROM_NAME', 'Weehawk');
    const from = `"${fromName}" <${fromEmail}>`;

    const result = await this.transporter.sendMail({
      from,
      to: request.to,
      subject: request.subject,
      ...(request.isHtml ? { html: request.body } : { text: request.body }),
    });
    const env = this.config.get<string>('NODE_ENV', 'development');
    if (env !== 'production') {
      const messageId = result?.messageId;
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

  async sendEmailConfirmation(
    to: string,
    firstName: string,
    confirmationLink: string,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2>Hi ${firstName},</h2>
        <p>Confirm your email address for your Weehawk account:</p>
        <a href="${confirmationLink}" style="
          background-color: #4CAF50;
          color: white;
          padding: 14px 20px;
          text-decoration: none;
          border-radius: 4px;
          display: inline-block;">
          Confirm email
        </a>
        <p style="color: #888; margin-top: 20px;">This link expires in 24 hours.</p>
      </div>`;
    await this.sendHtml(to, 'Confirm your email — Weehawk', html);
  }

  async sendPasswordReset(
    to: string,
    firstName: string,
    resetLink: string,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2>Hi ${firstName},</h2>
        <p>We received a request to reset the password for your Weehawk account. Use the button below:</p>
        <a href="${resetLink}" style="
          background-color: #e53935;
          color: white;
          padding: 14px 20px;
          text-decoration: none;
          border-radius: 4px;
          display: inline-block;">
          Reset password
        </a>
        <p style="color: #888; margin-top: 20px;">
          This link expires in one hour.
          If you did not request a reset, you can safely ignore this email.
        </p>
      </div>`;
    await this.sendHtml(to, 'Reset your Weehawk password', html);
  }

  async sendEmailChangeConfirmation(
    to: string,
    firstName: string,
    confirmationLink: string,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hi ${firstName},</h2>
        <p>Confirm your new email address for Weehawk:</p>
        <a href="${confirmationLink}" style="background-color: #4CAF50; color: white; padding: 14px 20px;
          text-decoration: none; border-radius: 4px;">
          Confirm new email
        </a>
        <p>This link expires in 24 hours.</p>
        <p>If you did not request this change, you can ignore this email.</p>
      </div>`;
    await this.sendHtml(to, 'Confirm your new email — Weehawk', html);
  }

  async sendEmailChangeNotification(
    to: string,
    firstName: string,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hi ${firstName},</h2>
        <p>A request was made to change the email address on your Weehawk account.</p>
        <p style="color: #b91c1c;">If this was not you, secure your account and contact support if needed.</p>
      </div>`;
    await this.sendHtml(to, 'Security alert: email change requested — Weehawk', html);
  }

  async sendEmailChangedConfirmation(
    to: string,
    firstName: string,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hi ${firstName},</h2>
        <p>The email address on your Weehawk account was updated successfully.</p>
        <p style="color: #b91c1c;">If you did not make this change, secure your account and contact support immediately.</p>
      </div>`;
    await this.sendHtml(to, 'Your Weehawk account email was updated', html);
  }
}
