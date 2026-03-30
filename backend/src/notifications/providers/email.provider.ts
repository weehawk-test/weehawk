import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationEmail } from '../entities/notification-email.entity';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderResult } from './provider.types';
import { readString } from './http-utils';

@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly type = NotificationChannelType.EMAIL;

  constructor(
    @InjectRepository(NotificationEmail)
    private readonly repo: Repository<NotificationEmail>,
  ) {}

  async saveConfig(channelId: string, config: Record<string, unknown>): Promise<void> {
    const toRaw = config['toAddresses'];
    const toAddresses = Array.isArray(toRaw)
      ? toRaw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    const smtpPort = Number.parseInt(readString(config, 'smtpPort') || '587', 10);

    await this.repo.save(
      this.repo.create({
        channelId,
        smtpServer: readString(config, 'smtpServer'),
        smtpPort: Number.isFinite(smtpPort) ? smtpPort : 587,
        username: readString(config, 'username'),
        password: readString(config, 'password'),
        fromAddress: readString(config, 'fromAddress'),
        toAddressesJson: JSON.stringify(toAddresses),
      }),
    );
  }

  async preview(channelId: string): Promise<ChannelPreview> {
    const row = await this.repo.findOne({ where: { channelId } });
    const username = row?.username?.trim() ?? '';
    const fromAddress = row?.fromAddress?.trim() ?? '';
    return {
      credentialPreview: username || 'smtp credentials',
      targetPreview: fromAddress || 'email',
    };
  }

  async send(channelId: string, channelName: string, message: string): Promise<ProviderResult> {
    const row = await this.repo.findOne({ where: { channelId } });
    if (!row) return { ok: false, description: 'Missing email configuration' };

    const smtpServer = row.smtpServer.trim();
    const smtpPort = row.smtpPort;
    const username = row.username.trim();
    const password = row.password;
    const fromAddress = row.fromAddress.trim();
    const toRaw = row.toAddressesJson ? JSON.parse(row.toAddressesJson) : [];
    const toAddresses = Array.isArray(toRaw)
      ? toRaw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];

    if (!smtpServer || !smtpPort || !username || !password || !fromAddress || toAddresses.length === 0) {
      return { ok: false, description: 'Missing SMTP configuration fields' };
    }

    const secure = smtpPort === 465;
    try {
      const transport = nodemailer.createTransport({
        host: smtpServer,
        port: smtpPort,
        secure,
        auth: { user: username, pass: password },
      });
      await transport.sendMail({
        from: fromAddress,
        to: toAddresses.join(', '),
        subject: `Weehawk Notification - ${channelName}`,
        text: message,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, description: e instanceof Error ? e.message : 'SMTP send failed' };
    }
  }
}

