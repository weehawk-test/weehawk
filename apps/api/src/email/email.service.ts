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

    const result = await this.mailer.sendMail({
      to: request.to,
      subject: request.subject,
      ...(request.isHtml ? { html: request.body } : { text: request.body }),
    });
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
        <h2>مرحباً ${firstName}!</h2>
        <p>اضغط على الزر لتأكيد بريدك الإلكتروني:</p>
        <a href="${confirmationLink}" style="
          background-color: #4CAF50;
          color: white;
          padding: 14px 20px;
          text-decoration: none;
          border-radius: 4px;
          display: inline-block;">
          تأكيد الإيميل
        </a>
        <p style="color: #888; margin-top: 20px;">صالح لمدة 24 ساعة فقط.</p>
      </div>`;
    await this.sendHtml(to, 'تأكيد بريدك الإلكتروني', html);
  }

  async sendPasswordReset(to: string, firstName: string, resetLink: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2>مرحباً ${firstName}!</h2>
        <p>طلبت إعادة تعيين كلمة المرور. اضغط على الزر:</p>
        <a href="${resetLink}" style="
          background-color: #e53935;
          color: white;
          padding: 14px 20px;
          text-decoration: none;
          border-radius: 4px;
          display: inline-block;">
          إعادة تعيين كلمة المرور
        </a>
        <p style="color: #888; margin-top: 20px;">
          صالح لمدة ساعة واحدة فقط.
          إذا لم تطلب هذا، تجاهل الإيميل.
        </p>
      </div>`;
    await this.sendHtml(to, 'إعادة تعيين كلمة المرور', html);
  }

  async sendEmailChangeConfirmation(
    to: string,
    firstName: string,
    confirmationLink: string,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>مرحباً ${firstName}!</h2>
        <p>طلبت تغيير إيميلك. اضغط على الزر للتأكيد:</p>
        <a href="${confirmationLink}" style="background-color: #4CAF50; color: white; padding: 14px 20px;
          text-decoration: none; border-radius: 4px;">
          تأكيد الإيميل الجديد
        </a>
        <p>صالح لمدة 24 ساعة فقط.</p>
        <p>إذا لم تطلب هذا، تجاهل الإيميل.</p>
      </div>`;
    await this.sendHtml(to, 'Confirm your new email', html);
  }

  async sendEmailChangeNotification(to: string, firstName: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>مرحباً ${firstName}!</h2>
        <p>تم طلب تغيير إيميل حسابك.</p>
        <p style="color: red;">إذا لم تطلب هذا، يرجى التواصل معنا فوراً!</p>
      </div>`;
    await this.sendHtml(to, 'Security Alert: Email Change Requested', html);
  }

  async sendEmailChangedConfirmation(to: string, firstName: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>مرحباً ${firstName}!</h2>
        <p>تم تغيير إيميل حسابك بنجاح</p>
        <p style="color: red;">إذا لم تطلب هذا، يرجى التواصل معنا فوراً!</p>
      </div>`;
    await this.sendHtml(to, 'Your email has been changed', html);
  }
}
