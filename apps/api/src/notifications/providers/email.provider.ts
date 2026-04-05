import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { NotificationChannel } from '../entities/notification-channel.entity';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { Notification } from '../entities/notification.entity';
import { notificationPlainText } from '../notification-format';
import { channelConfigRecord } from './channel-config';
import { NotificationProvider } from './notification-provider.interface';
import { ChannelPreview, ProviderSendResult } from './provider.types';
import { readString } from './http-utils';

@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly type = NotificationChannelType.EMAIL;

  normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const toRaw = config['toAddresses'];
    const toAddresses = Array.isArray(toRaw)
      ? toRaw.filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0,
        )
      : [];
    const smtpPort = Number.parseInt(
      readString(config, 'smtpPort') || '587',
      10,
    );
    return {
      smtpServer: readString(config, 'smtpServer'),
      smtpPort: Number.isFinite(smtpPort) ? smtpPort : 587,
      username: readString(config, 'username'),
      password: readString(config, 'password'),
      fromAddress: readString(config, 'fromAddress'),
      toAddresses,
    };
  }

  async preview(channel: NotificationChannel): Promise<ChannelPreview> {
    const cfg = channelConfigRecord(channel);
    const username = readString(cfg, 'username');
    const fromAddress = readString(cfg, 'fromAddress');
    return {
      credentialPreview: username || 'smtp credentials',
      targetPreview: fromAddress || 'email',
    };
  }

  async send(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<ProviderSendResult> {
    const cfg = channelConfigRecord(channel);
    const smtpServer = readString(cfg, 'smtpServer');
    const smtpPort = Number(cfg['smtpPort']);
    const username = readString(cfg, 'username');
    const password = readString(cfg, 'password');
    const fromAddress = readString(cfg, 'fromAddress');
    const toRaw = cfg['toAddresses'];
    const toAddresses = Array.isArray(toRaw)
      ? toRaw.filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0,
        )
      : [];

    if (
      !smtpServer ||
      !Number.isFinite(smtpPort) ||
      !username ||
      !password ||
      !fromAddress ||
      toAddresses.length === 0
    ) {
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
        subject: notification.title.trim()
          ? `Weehawk — ${notification.title}`
          : `Weehawk Notification — ${channel.name}`,
        text: notificationPlainText(notification),
      });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        description: e instanceof Error ? e.message : 'SMTP send failed',
      };
    }
  }
}
