import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { ExecutorService } from '../services/ExecutorService';
import { ServicesService } from '../services/services.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { Webhook } from './entities/webhook.entity';

export type WebhookListRow = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  targetMode: string;
  serviceId: number | null;
  serviceAction: string | null;
  notifyOnTrigger: boolean;
  createdAt: string;
  summary: string;
};

export type WebhookDetailRow = WebhookListRow & {
  volumeSource: string | null;
  dockerCommand: string | null;
  notifyChannelId: string | null;
  secretToken: string;
};

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    private readonly servicesService: ServicesService,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private validateCreate(dto: CreateWebhookDto): void {
    if (dto.targetMode === 'service') {
      if (dto.serviceId == null || dto.serviceAction == null) {
        throw new BadRequestException(
          'Service webhooks require serviceId and serviceAction.',
        );
      }
      if (dto.serviceAction === 'volume_backup' && !dto.volumeSource?.trim()) {
        throw new BadRequestException(
          'volumeSource is required for volume backup.',
        );
      }
      if (
        dto.serviceAction === 'docker_command' &&
        !dto.dockerCommand?.trim()
      ) {
        throw new BadRequestException('dockerCommand is required.');
      }
    }
    const notify = dto.notifyOnTrigger === true;
    if (notify && !dto.notifyChannelId) {
      throw new BadRequestException(
        'Select a Telegram notification channel when notify on trigger is enabled.',
      );
    }
  }

  private async assertNotificationChannel(
    userId: number,
    channelId: string,
  ): Promise<void> {
    const rows = await this.notificationsService.listChannels(userId);
    if (!rows.some((c) => c.id === channelId)) {
      throw new BadRequestException('Notification channel not found.');
    }
  }

  private summaryLabel(w: Webhook): string {
    if (w.targetMode === 'notify_only') {
      return 'Notification only';
    }
    const a = w.serviceAction ?? '—';
    if (a === 'redeploy') return 'Redeploy service';
    if (a === 'volume_backup') return `Backup volume: ${w.volumeSource ?? '—'}`;
    if (a === 'docker_command') return 'Custom docker command';
    return a;
  }

  private toListRow(w: Webhook): WebhookListRow {
    return {
      id: w.id,
      name: w.name,
      description: w.description ?? '',
      isActive: w.isActive,
      targetMode: w.targetMode,
      serviceId: w.serviceId,
      serviceAction: w.serviceAction,
      notifyOnTrigger: w.notifyOnTrigger,
      createdAt: w.createdAt.toISOString(),
      summary: this.summaryLabel(w),
    };
  }

  private toDetailRow(w: Webhook): WebhookDetailRow {
    return {
      ...this.toListRow(w),
      volumeSource: w.volumeSource,
      dockerCommand: w.dockerCommand,
      notifyChannelId: w.notifyChannelId,
      secretToken: w.secretToken,
    };
  }

  async create(
    userId: number,
    dto: CreateWebhookDto,
  ): Promise<WebhookDetailRow> {
    this.validateCreate(dto);
    if (dto.notifyOnTrigger && dto.notifyChannelId) {
      await this.assertNotificationChannel(userId, dto.notifyChannelId);
    }
    if (dto.targetMode === 'service' && dto.serviceId != null) {
      try {
        await this.servicesService.findOne(dto.serviceId);
      } catch {
        throw new BadRequestException('Service not found.');
      }
    }

    const secretToken = randomBytes(32).toString('hex');
    const w = this.webhookRepo.create({
      userId,
      secretToken,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      isActive: true,
      targetMode: dto.targetMode,
      serviceId: dto.targetMode === 'service' ? dto.serviceId : null,
      serviceAction: dto.targetMode === 'service' ? dto.serviceAction : null,
      volumeSource:
        dto.targetMode === 'service' &&
        dto.serviceAction === 'volume_backup' &&
        dto.volumeSource
          ? dto.volumeSource.trim()
          : null,
      dockerCommand:
        dto.targetMode === 'service' &&
        dto.serviceAction === 'docker_command' &&
        dto.dockerCommand
          ? dto.dockerCommand.trim()
          : null,
      notifyOnTrigger: dto.notifyOnTrigger === true,
      notifyChannelId:
        dto.notifyOnTrigger === true ? (dto.notifyChannelId ?? null) : null,
    });
    const saved = await this.webhookRepo.save(w);
    return this.toDetailRow(saved);
  }

  async list(userId: number): Promise<WebhookListRow[]> {
    const list = await this.webhookRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return list.map((w) => this.toListRow(w));
  }

  async findOne(userId: number, id: string): Promise<WebhookDetailRow> {
    const w = await this.webhookRepo.findOne({ where: { id, userId } });
    if (!w) throw new NotFoundException('Webhook not found');
    return this.toDetailRow(w);
  }

  async update(
    userId: number,
    id: string,
    dto: UpdateWebhookDto,
  ): Promise<WebhookDetailRow> {
    const w = await this.webhookRepo.findOne({ where: { id, userId } });
    if (!w) throw new NotFoundException('Webhook not found');

    if (dto.name !== undefined) w.name = dto.name.trim();
    if (dto.description !== undefined) {
      w.description = dto.description.trim() || null;
    }
    if (dto.isActive !== undefined) w.isActive = dto.isActive;
    if (dto.notifyOnTrigger !== undefined) {
      w.notifyOnTrigger = dto.notifyOnTrigger;
      if (!dto.notifyOnTrigger) w.notifyChannelId = null;
    }
    if (dto.notifyChannelId !== undefined) {
      w.notifyChannelId = dto.notifyChannelId;
    }
    if (w.notifyOnTrigger && w.notifyChannelId) {
      await this.assertNotificationChannel(userId, w.notifyChannelId);
    }
    if (w.notifyOnTrigger && !w.notifyChannelId) {
      throw new BadRequestException(
        'notifyChannelId is required when notify on trigger is enabled.',
      );
    }

    const saved = await this.webhookRepo.save(w);
    return this.toDetailRow(saved);
  }

  async remove(userId: number, id: string): Promise<void> {
    const res = await this.webhookRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Webhook not found');
  }

  async triggerByToken(token: string): Promise<Record<string, unknown>> {
    const w = await this.webhookRepo.findOne({
      where: { secretToken: token },
    });
    if (!w || !w.isActive) {
      throw new NotFoundException('Unknown or inactive webhook');
    }

    let action = 'none';
    let success = true;
    let output = '';

    try {
      if (w.targetMode === 'notify_only') {
        action = 'notify_only';
        output = 'No Docker action configured.';
      } else if (w.targetMode === 'service' && w.serviceId != null) {
        if (w.serviceAction === 'redeploy') {
          action = 'redeploy';
          const r = await this.servicesService.executeDeployment(
            w.serviceId,
            'redeploy',
          );
          success = Boolean(r.success);
          output = String(r.output ?? '');
        } else if (w.serviceAction === 'volume_backup' && w.volumeSource) {
          action = 'volume_backup';
          const destDir = path.join(
            process.cwd(),
            'webhook-backups',
            String(w.userId),
            w.id,
          );
          const r = await this.executorService.backupDockerVolume(
            w.volumeSource,
            destDir,
          );
          success = r.success;
          output = r.output;
        } else if (w.serviceAction === 'docker_command' && w.dockerCommand) {
          action = 'docker_command';
          const r = await this.executorService.runWebhookDockerCommand(
            w.serviceId,
            w.dockerCommand,
          );
          success = r.success;
          output = r.output;
        } else {
          success = false;
          output = 'Webhook is misconfigured (missing action details).';
        }
      }
    } catch (e) {
      success = false;
      output = e instanceof Error ? e.message : String(e);
    }

    const payload = {
      ok: success,
      webhook: w.name,
      action,
      output: output.slice(0, 8000),
    };

    if (w.notifyOnTrigger && w.notifyChannelId) {
      const msg = [
        `Webhook: ${w.name}`,
        `Action: ${action}`,
        `Success: ${success}`,
        '',
        output.slice(0, 3500),
      ].join('\n');
      try {
        await this.notificationsService.sendMessage(
          w.userId,
          w.notifyChannelId,
          msg,
        );
      } catch {
        /* avoid failing the HTTP response */
      }
    }

    return payload;
  }
}
