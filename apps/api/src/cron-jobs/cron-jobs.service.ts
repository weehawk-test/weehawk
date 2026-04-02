import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { getVolumeBackupDestDir } from '../services/deployment-paths';
import { ExecutorService } from '../executor/executor.service';
import { ServicesService } from '../services/services.service';
import { CreateCronJobDto } from './dto/create-cron-job.dto';
import { UpdateCronJobDto } from './dto/update-cron-job.dto';
import { CronJob } from './entities/cron-job.entity';

export type CronJobListRow = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  cronExpression: string;
  targetMode: string;
  serviceId: number | null;
  serviceAction: string | null;
  notifyOnTrigger: boolean;
  createdAt: string;
  summary: string;
};

export type CronJobDetailRow = CronJobListRow & {
  volumeSource: string | null;
  dockerCommand: string | null;
  notifyChannelId: string | null;
  notifyMessage: string | null;
};

@Injectable()
export class CronJobsService {
  private readonly lastTickByJob = new Map<string, string>();
  private isTickRunning = false;

  constructor(
    @InjectRepository(CronJob)
    private readonly cronJobRepo: Repository<CronJob>,
    private readonly servicesService: ServicesService,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private validateCronField(value: string, min: number, max: number): boolean {
    if (value === '*') return true;
    if (/^\*\/\d+$/.test(value)) {
      const step = Number(value.slice(2));
      return step >= 1 && step <= max;
    }
    if (/^\d+$/.test(value)) {
      const n = Number(value);
      return n >= min && n <= max;
    }
    return false;
  }

  private isValidCronExpression(expr: string): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    return (
      this.validateCronField(parts[0], 0, 59) &&
      this.validateCronField(parts[1], 0, 23) &&
      this.validateCronField(parts[2], 1, 31) &&
      this.validateCronField(parts[3], 1, 12) &&
      this.validateCronField(parts[4], 0, 6)
    );
  }

  private matchesCronField(field: string, current: number): boolean {
    if (field === '*') return true;
    if (field.startsWith('*/')) {
      const step = Number(field.slice(2));
      return step > 0 && current % step === 0;
    }
    return Number(field) === current;
  }

  private matchesCron(expr: string, now: Date): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    return (
      this.matchesCronField(parts[0], now.getMinutes()) &&
      this.matchesCronField(parts[1], now.getHours()) &&
      this.matchesCronField(parts[2], now.getDate()) &&
      this.matchesCronField(parts[3], now.getMonth() + 1) &&
      this.matchesCronField(parts[4], now.getDay())
    );
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

  private validateCreate(dto: CreateCronJobDto): void {
    if (!this.isValidCronExpression(dto.cronExpression)) {
      throw new BadRequestException('Invalid cron expression.');
    }
    if (dto.targetMode === 'service') {
      if (dto.serviceAction == null) {
        throw new BadRequestException(
          'Service cron jobs require serviceAction.',
        );
      }
      if (dto.serviceAction !== 'no_action' && dto.serviceId == null) {
        throw new BadRequestException(
          'serviceId is required unless action is no_action.',
        );
      }
      if (dto.serviceAction === 'volume_backup' && !dto.volumeSource?.trim()) {
        throw new BadRequestException('volumeSource is required for volume backup.');
      }
      if (
        dto.serviceAction === 'docker_command' &&
        !dto.dockerCommand?.trim()
      ) {
        throw new BadRequestException('dockerCommand is required.');
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

  private summaryLabel(w: CronJob): string {
    const a = w.serviceAction ?? '—';
    if (a === 'redeploy') return `[Cron ${w.cronExpression}] Redeploy service`;
    if (a === 'volume_backup') {
      return `[Cron ${w.cronExpression}] Backup volume: ${w.volumeSource ?? '—'}`;
    }
    if (a === 'docker_command') return `[Cron ${w.cronExpression}] Custom docker command`;
    if (a === 'no_action') return `[Cron ${w.cronExpression}] No action (just notification)`;
    return `[Cron ${w.cronExpression}] ${a}`;
  }

  // Backward-compat: old builds stored generated multi-line cron summaries as notifyMessage.
  // If that legacy format is detected, keep only the human-entered short text.
  private normalizeNotificationMessage(message: string): string {
    const trimmed = message.trim();
    const legacyLines = trimmed.split(/\r?\n/);
    if (legacyLines.length < 4) return trimmed;
    const cronJobLine = legacyLines.find((l) => l.startsWith('Cron Job:'));
    const cronLine = legacyLines.find((l) => l.startsWith('Cron:'));
    const actionLine = legacyLines.find((l) => l.startsWith('Action:'));
    const successLine = legacyLines.find((l) => l.startsWith('Success:'));
    if (cronJobLine && cronLine && actionLine && successLine) {
      const extracted = cronJobLine.replace(/^Cron Job:\s*/, '').trim();
      return extracted || trimmed;
    }
    return trimmed;
  }

  private toListRow(w: CronJob): CronJobListRow {
    return {
      id: w.id,
      name: w.name,
      description: w.description ?? '',
      isActive: w.isActive,
      cronExpression: w.cronExpression,
      targetMode: w.targetMode,
      serviceId: w.serviceId,
      serviceAction: w.serviceAction,
      notifyOnTrigger: w.notifyOnTrigger,
      createdAt: w.createdAt.toISOString(),
      summary: this.summaryLabel(w),
    };
  }

  private toDetailRow(w: CronJob): CronJobDetailRow {
    return {
      ...this.toListRow(w),
      volumeSource: w.volumeSource,
      dockerCommand: w.dockerCommand,
      notifyChannelId: w.notifyChannelId,
      notifyMessage: w.notifyMessage,
    };
  }

  async create(userId: number, dto: CreateCronJobDto): Promise<CronJobDetailRow> {
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
    const job = this.cronJobRepo.create({
      userId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      isActive: true,
      cronExpression: dto.cronExpression.trim(),
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
      notifyOnTrigger:
        Boolean(dto.notifyChannelId?.trim()) &&
        Boolean(dto.notifyMessage?.trim()),
      notifyChannelId: dto.notifyChannelId?.trim() || null,
      notifyMessage: dto.notifyMessage?.trim() || null,
    });
    const saved = await this.cronJobRepo.save(job);
    return this.toDetailRow(saved);
  }

  async list(userId: number): Promise<CronJobListRow[]> {
    const list = await this.cronJobRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return list.map((w) => this.toListRow(w));
  }

  async findOne(userId: number, id: string): Promise<CronJobDetailRow> {
    const job = await this.cronJobRepo.findOne({ where: { id, userId } });
    if (!job) throw new NotFoundException('Cron job not found');
    return this.toDetailRow(job);
  }

  async update(
    userId: number,
    id: string,
    dto: UpdateCronJobDto,
  ): Promise<CronJobDetailRow> {
    const job = await this.cronJobRepo.findOne({ where: { id, userId } });
    if (!job) throw new NotFoundException('Cron job not found');

    if (dto.name !== undefined) job.name = dto.name.trim();
    if (dto.description !== undefined) job.description = dto.description.trim() || null;
    if (dto.isActive !== undefined) job.isActive = dto.isActive;
    if (dto.cronExpression !== undefined) {
      const expr = dto.cronExpression.trim();
      if (!this.isValidCronExpression(expr)) {
        throw new BadRequestException('Invalid cron expression.');
      }
      job.cronExpression = expr;
    }
    if (dto.notifyChannelId !== undefined) {
      job.notifyChannelId = dto.notifyChannelId?.trim() || null;
    }
    if (dto.notifyMessage !== undefined) {
      job.notifyMessage = dto.notifyMessage?.trim() || null;
    }
    if (job.notifyChannelId && job.notifyMessage) {
      job.notifyOnTrigger = true;
      await this.assertNotificationChannel(userId, job.notifyChannelId);
    } else if (!job.notifyChannelId && !job.notifyMessage) {
      job.notifyOnTrigger = false;
    } else {
      throw new BadRequestException(
        'Provide both notifyChannelId and notifyMessage, or clear both.',
      );
    }

    const saved = await this.cronJobRepo.save(job);
    return this.toDetailRow(saved);
  }

  async remove(userId: number, id: string): Promise<void> {
    const res = await this.cronJobRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Cron job not found');
  }

  private async execute(job: CronJob): Promise<void> {
    let action = 'none';
    let success = true;
    let output = '';

    try {
      if (job.targetMode === 'service') {
        if (job.serviceAction === 'no_action') {
          action = 'no_action';
          output = 'No Docker action selected.';
        } else if (job.serviceAction === 'redeploy' && job.serviceId != null) {
          action = 'redeploy';
          const r = await this.servicesService.executeDeployment(
            job.serviceId,
            'redeploy',
          );
          success = Boolean(r.success);
          output = String(r.output ?? '');
        } else if (
          job.serviceAction === 'volume_backup' &&
          job.volumeSource &&
          job.serviceId != null
        ) {
          action = 'volume_backup';
          const destDir = getVolumeBackupDestDir(job.userId, job.id);
          const r = await this.executorService.backupDockerVolume(
            job.volumeSource,
            destDir,
          );
          success = r.success;
          output = r.output;
        } else if (
          job.serviceAction === 'docker_command' &&
          job.dockerCommand &&
          job.serviceId != null
        ) {
          action = 'docker_command';
          const r = await this.executorService.runWebhookDockerCommand(
            job.serviceId,
            job.dockerCommand,
          );
          success = r.success;
          output = r.output;
        } else {
          success = false;
          output = 'Cron job is misconfigured (missing action details).';
        }
      }
    } catch (e) {
      success = false;
      output = e instanceof Error ? e.message : String(e);
    }

    if (job.notifyOnTrigger && job.notifyChannelId && job.notifyMessage) {
      try {
        await this.notificationsService.sendMessage(
          job.userId,
          job.notifyChannelId,
          this.normalizeNotificationMessage(job.notifyMessage),
        );
      } catch {
        // best effort
      }
    }
  }

  async runDueCronJobs(): Promise<void> {
    if (this.isTickRunning) return;
    this.isTickRunning = true;
    const jobs = await this.cronJobRepo.find({
      where: { isActive: true },
    });
    try {
      for (const job of jobs) {
        const now = new Date();
        const minuteKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
        if (this.lastTickByJob.get(job.id) === minuteKey) continue;
        if (!this.matchesCron(job.cronExpression, now)) continue;
        this.lastTickByJob.set(job.id, minuteKey);
        try {
          const fresh = await this.cronJobRepo.findOne({ where: { id: job.id } });
          if (!fresh || !fresh.isActive) continue;
          await this.execute(fresh);
        } catch {
          // best effort
        }
      }
    } finally {
      this.isTickRunning = false;
    }
  }
}
