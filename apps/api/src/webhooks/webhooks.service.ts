import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { Repository } from 'typeorm';
import { NotificationService } from '../notifications/notification.service';
import {
  createBackupTempDir,
  removeBackupTempDir,
} from '../services/deployment-paths';
import { ExecutorService } from '../executor/executor.service';
import { S3Service } from '../s3/s3.service';
import { ServicesService } from '../services/services.service';
import { getErrorMessage } from '../utils/error-message';
import type { DatabaseBackupConfig } from '../backup/database-backup.types';
import { describeDatabaseBackupPreview } from '../backup/database-backup.types';
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
  databaseBackupConfig: DatabaseBackupConfig | null;
  databaseBackupPreview: string | null;
  backupS3ProfileName: string | null;
  notifyChannelId: string | null;
  notifyMessage: string | null;
  secretToken: string;
};

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    private readonly servicesService: ServicesService,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationService,
    private readonly s3Service: S3Service,
  ) {}

  private validateCreate(dto: CreateWebhookDto): void {
    if (dto.targetMode === 'service') {
      if (dto.serviceAction == null) {
        throw new BadRequestException(
          'Service webhooks require serviceAction.',
        );
      }
      if (dto.serviceAction !== 'no_action' && dto.serviceId == null) {
        throw new BadRequestException(
          'serviceId is required unless action is no_action.',
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
      if (
        dto.serviceAction === 'database_backup' &&
        !dto.databaseBackupConfig
      ) {
        throw new BadRequestException(
          'databaseBackupConfig is required for database backup.',
        );
      }
      if (
        (dto.serviceAction === 'volume_backup' ||
          dto.serviceAction === 'database_backup') &&
        !dto.backupS3ProfileName?.trim()
      ) {
        throw new BadRequestException(
          'backupS3ProfileName is required: backups are stored in S3 only.',
        );
      }
    }
    const hasNotifyChannel = Boolean(dto.notifyChannelId?.trim());
    const hasNotifyMessage = Boolean(dto.notifyMessage?.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      throw new BadRequestException(
        'Provide both notifyChannelId and notifyMessage, or leave both empty.',
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
    const a = w.serviceAction ?? '—';
    if (a === 'redeploy') return 'Redeploy';
    if (a === 'volume_backup') return `Volume → S3: ${w.volumeSource ?? '—'}`;
    if (a === 'database_backup') {
      const eng = w.databaseBackupConfig?.engine;
      return eng ? `Database → S3 (${eng})` : 'Database → S3';
    }
    if (a === 'docker_command') return 'Docker command';
    if (a === 'no_action') return 'No action';
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
    const cfg = w.databaseBackupConfig;
    return {
      ...this.toListRow(w),
      volumeSource: w.volumeSource,
      dockerCommand: w.dockerCommand,
      databaseBackupConfig: cfg,
      databaseBackupPreview: cfg ? describeDatabaseBackupPreview(cfg) : null,
      backupS3ProfileName: w.backupS3ProfileName,
      notifyChannelId: w.notifyChannelId,
      notifyMessage: w.notifyMessage,
      secretToken: w.secretToken,
    };
  }

  private async finalizeBackupWithS3(
    userId: number,
    contextId: string,
    profileName: string | null | undefined,
    destDir: string,
    r: { success: boolean; output: string; archiveBasename?: string },
  ): Promise<{ success: boolean; output: string }> {
    if (!r.success || !r.archiveBasename) {
      return { success: r.success, output: r.output };
    }
    const trimmed = profileName?.trim();
    if (!trimmed) {
      return {
        success: false,
        output: `${r.output}\nS3 destination is not configured.`,
      };
    }
    const localPath = path.join(destDir, r.archiveBasename);
    const key = `weehawk/backups/u${userId}/${contextId}/${r.archiveBasename}`;
    try {
      const { bucket, key: uploadedKey } = await this.s3Service.uploadLocalFile(
        trimmed,
        localPath,
        key,
      );
      return {
        success: true,
        output: `${r.output}\nUploaded to s3://${bucket}/${uploadedKey}`,
      };
    } catch (e) {
      return {
        success: false,
        output: `${r.output}\nS3 upload failed: ${getErrorMessage(e)}`,
      };
    }
  }

  async create(
    userId: number,
    dto: CreateWebhookDto,
  ): Promise<WebhookDetailRow> {
    this.validateCreate(dto);
    if (dto.notifyChannelId) {
      await this.assertNotificationChannel(userId, dto.notifyChannelId);
    }
    if (dto.targetMode === 'service' && dto.serviceId != null) {
      try {
        await this.servicesService.findOne(dto.serviceId);
      } catch {
        throw new BadRequestException('Service not found.');
      }
    }

    const backupProfile =
      dto.targetMode === 'service' &&
      (dto.serviceAction === 'volume_backup' ||
        dto.serviceAction === 'database_backup')
        ? dto.backupS3ProfileName!.trim()
        : null;
    if (backupProfile) {
      await this.s3Service.assertProfileExists(backupProfile);
    }

    const secretToken = randomBytes(32).toString('hex');
    const w = this.webhookRepo.create({
      userId,
      secretToken,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      isActive: true,
      targetMode: dto.targetMode,
      serviceId:
        dto.targetMode === 'service' && dto.serviceAction !== 'no_action'
          ? dto.serviceId
          : null,
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
      databaseBackupConfig:
        dto.targetMode === 'service' &&
        dto.serviceAction === 'database_backup' &&
        dto.databaseBackupConfig
          ? (dto.databaseBackupConfig as unknown as DatabaseBackupConfig)
          : null,
      backupS3ProfileName: backupProfile,
      notifyOnTrigger:
        Boolean(dto.notifyChannelId?.trim()) &&
        Boolean(dto.notifyMessage?.trim()),
      notifyChannelId: dto.notifyChannelId?.trim() || null,
      notifyMessage: dto.notifyMessage?.trim() || null,
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
    if (dto.notifyChannelId !== undefined) {
      w.notifyChannelId = dto.notifyChannelId?.trim() || null;
    }
    if (dto.notifyMessage !== undefined) {
      w.notifyMessage = dto.notifyMessage?.trim() || null;
    }
    if (dto.backupS3ProfileName !== undefined) {
      const v = dto.backupS3ProfileName?.trim() || null;
      if (v) {
        await this.s3Service.assertProfileExists(v);
      }
      if (
        (w.serviceAction === 'volume_backup' ||
          w.serviceAction === 'database_backup') &&
        !v
      ) {
        throw new BadRequestException(
          'S3 destination is required for backup actions.',
        );
      }
      w.backupS3ProfileName = v;
    }
    if (dto.databaseBackupConfig !== undefined) {
      if (w.serviceAction === 'database_backup') {
        if (!dto.databaseBackupConfig) {
          throw new BadRequestException(
            'databaseBackupConfig is required for database backup.',
          );
        }
        w.databaseBackupConfig =
          dto.databaseBackupConfig as unknown as DatabaseBackupConfig;
        w.dockerCommand = null;
      }
    }
    if (w.notifyChannelId && w.notifyMessage) {
      w.notifyOnTrigger = true;
      await this.assertNotificationChannel(userId, w.notifyChannelId);
    } else if (!w.notifyChannelId && !w.notifyMessage) {
      w.notifyOnTrigger = false;
    } else {
      throw new BadRequestException(
        'Provide both notifyChannelId and notifyMessage, or clear both.',
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
      if (w.targetMode === 'service') {
        if (w.serviceAction === 'no_action') {
          action = 'no_action';
          output = 'No Docker action selected.';
        } else if (w.serviceAction === 'redeploy' && w.serviceId != null) {
          action = 'redeploy';
          const r = await this.servicesService.executeDeployment(
            w.serviceId,
            'redeploy',
          );
          success = Boolean(r.success);
          output = String(r.output ?? '');
        } else if (
          w.serviceAction === 'volume_backup' &&
          w.volumeSource &&
          w.serviceId != null
        ) {
          action = 'volume_backup';
          if (!w.backupS3ProfileName?.trim()) {
            success = false;
            output =
              'S3 destination is not configured. Edit the webhook and choose a saved S3 profile.';
          } else {
            let destDir: string | null = null;
            try {
              destDir = await createBackupTempDir();
              const r = await this.executorService.backupDockerVolume(
                w.volumeSource,
                destDir,
              );
              const final = await this.finalizeBackupWithS3(
                w.userId,
                w.id,
                w.backupS3ProfileName,
                destDir,
                r,
              );
              success = final.success;
              output = final.output;
            } finally {
              if (destDir) {
                await removeBackupTempDir(destDir).catch(() => {
                  /* best effort */
                });
              }
            }
          }
        } else if (w.serviceAction === 'database_backup' && w.serviceId != null) {
          action = 'database_backup';
          if (!w.backupS3ProfileName?.trim()) {
            success = false;
            output =
              'S3 destination is not configured. Edit the webhook and choose a saved S3 profile.';
          } else if (w.databaseBackupConfig) {
            let destDir: string | null = null;
            try {
              destDir = await createBackupTempDir();
              const r = await this.executorService.backupDatabaseStructured(
                w.serviceId,
                w.databaseBackupConfig,
                destDir,
              );
              const final = await this.finalizeBackupWithS3(
                w.userId,
                w.id,
                w.backupS3ProfileName,
                destDir,
                r,
              );
              success = final.success;
              output = final.output;
            } finally {
              if (destDir) {
                await removeBackupTempDir(destDir).catch(() => {
                  /* best effort */
                });
              }
            }
          } else if (w.dockerCommand) {
            let destDir: string | null = null;
            try {
              destDir = await createBackupTempDir();
              const r = await this.executorService.backupDatabaseFromDockerCommand(
                w.serviceId,
                w.dockerCommand,
                destDir,
              );
              const final = await this.finalizeBackupWithS3(
                w.userId,
                w.id,
                w.backupS3ProfileName,
                destDir,
                r,
              );
              success = final.success;
              output = final.output;
            } finally {
              if (destDir) {
                await removeBackupTempDir(destDir).catch(() => {
                  /* best effort */
                });
              }
            }
          } else {
            success = false;
            output =
              'Database backup is not configured (missing databaseBackupConfig).';
          }
        } else if (
          w.serviceAction === 'docker_command' &&
          w.dockerCommand &&
          w.serviceId != null
        ) {
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

    if (w.notifyOnTrigger && w.notifyChannelId && w.notifyMessage) {
      try {
        await this.notificationsService.sendMessage(
          w.userId,
          w.notifyChannelId,
          w.notifyMessage,
        );
      } catch {
        /* avoid failing the HTTP response */
      }
    }

    return payload;
  }
}
