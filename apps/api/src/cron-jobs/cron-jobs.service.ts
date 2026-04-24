import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from '../notifications/notification.service';
import {
  buildRemoteEnvAndWrappedShInstallScript,
  buildRemoteNotificationEnvLinesFromChannel,
  normalizeRemoteNotificationMessage,
  remoteInstallShQuote,
  REMOTE_NOTIFY_DEFAULTS_CRON,
} from '../common/remote-wrapped-script-install';
import { ExecutorService } from '../executor/executor.service';
import { S3Service } from '../s3/s3.service';
import { ServicesService } from '../services/services.service';
import { RemoteServersService } from '../remote-servers/remote-servers.service';
import { getErrorMessage } from '../utils/error-message';
import type { DatabaseBackupConfig } from '../backup/database-backup.types';
import { describeDatabaseBackupPreview } from '../backup/database-backup.types';
import { CreateCronJobDto } from './dto/create-cron-job.dto';
import { UpdateCronJobDto } from './dto/update-cron-job.dto';
import { CronJob } from './entities/cron-job.entity';
import { generatePublicId, isLikelyNumericId } from '../common/public-id';

export type CronJobListRow = {
  id: number;
  publicId: string;
  name: string;
  description: string;
  isActive: boolean;
  cronExpression: string;
  targetMode: string;
  serviceId: number | null;
  remoteServerId: number | null;
  serviceAction: string | null;
  notifyOnTrigger: boolean;
  createdAt: string;
  summary: string;
};

export type CronJobDetailRow = CronJobListRow & {
  volumeSource: string | null;
  dockerCommand: string | null;
  databaseBackupConfig: DatabaseBackupConfig | null;
  databaseBackupPreview: string | null;
  backupS3ProfileName: string | null;
  notifyChannelId: number | null;
  notifyMessage: string | null;
};

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);
  private readonly lastTickByJob = new Map<number, string>();
  private isTickRunning = false;

  constructor(
    @InjectRepository(CronJob)
    private readonly cronJobRepo: Repository<CronJob>,
    private readonly servicesService: ServicesService,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationService,
    private readonly s3Service: S3Service,
    private readonly remoteServersService: RemoteServersService,
  ) {}

  private runRemoteSyncInBackground(taskLabel: string, run: () => Promise<void>): void {
    setTimeout(() => {
      void run().catch((error: unknown) => {
        this.logger.warn(
          `Background cron sync failed (${taskLabel}): ${getErrorMessage(error)}`,
        );
      });
    }, 0);
  }

  private async ensurePublicId(row: CronJob): Promise<CronJob> {
    if (row.publicId) return row;
    row.publicId = generatePublicId('crn');
    return this.cronJobRepo.save(row);
  }

  private async resolveEntity(userId: number, idOrPublicId: string | number): Promise<CronJob> {
    const raw = String(idOrPublicId).trim();
    const where = isLikelyNumericId(raw)
      ? [{ id: Number(raw), userId }, { publicId: raw, userId }]
      : [{ publicId: raw, userId }];
    const row = await this.cronJobRepo.findOne({ where });
    if (!row) throw new NotFoundException('Cron job not found');
    return this.ensurePublicId(row);
  }

  private shQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private cronMarker(jobId: number): string {
    return `WEEHAWK_CRON_JOB:${jobId}`;
  }

  private scriptDirRemote(): string {
    return '/opt/weehawk-scripts';
  }

  private scriptPathRemote(jobId: number): string {
    return `${this.scriptDirRemote()}/${jobId}.sh`;
  }

  private envPathRemote(jobId: number): string {
    return `${this.scriptDirRemote()}/${jobId}.env`;
  }

  private buildRemoteCrontabLine(job: CronJob): string {
    if (job.serviceAction !== 'docker_command' || !job.dockerCommand?.trim()) {
      throw new BadRequestException(
        'Only docker_command cron jobs are supported for direct Linux crontab execution.',
      );
    }
    const scriptPath = this.scriptPathRemote(job.id);
    const marker = this.cronMarker(job.id);
    return `${job.cronExpression.trim()} /bin/bash ${this.shQuote(scriptPath)} >/dev/null 2>&1 # ${marker}`;
  }

  private async buildNotificationEnvForJob(job: CronJob): Promise<string[]> {
    if (!job.notifyOnTrigger || !job.notifyChannelId || !job.notifyMessage) {
      return buildRemoteNotificationEnvLinesFromChannel(false, null, null);
    }
    const channel = await this.notificationsService.getChannelRuntimeConfig(
      job.userId,
      job.notifyChannelId,
    );
    return buildRemoteNotificationEnvLinesFromChannel(
      true,
      channel,
      job.notifyMessage,
    );
  }

  private async resolveCronRemoteServerId(job: CronJob): Promise<number> {
    if (job.remoteServerId != null) {
      await this.remoteServersService.assertDeployServerById(
        job.remoteServerId,
        job.userId,
      );
      return job.remoteServerId;
    }
    if (job.serviceId != null) {
      const ids = await this.servicesService.getDockerSshTargetIds(job.serviceId);
      if (ids.remoteServerId != null) {
        await this.remoteServersService.assertDeployServerById(
          ids.remoteServerId,
          job.userId,
        );
        return ids.remoteServerId;
      }
    }
    throw new BadRequestException(
      `Cron job "${job.name}" needs a remote deploy server to install Linux crontab via SSH.`,
    );
  }

  private async tryResolveCronRemoteServerId(job: CronJob): Promise<number | null> {
    try {
      return await this.resolveCronRemoteServerId(job);
    } catch {
      return null;
    }
  }

  private async removeCrontabEntryForRemote(
    remoteServerId: number,
    projectUserId: number,
    jobId: number,
  ): Promise<void> {
    const marker = this.cronMarker(jobId);
    const script = [
      'tmp="$(mktemp)"',
      `( crontab -l 2>/dev/null || true ) | grep -F -v ${this.shQuote(marker)} > "$tmp" || true`,
      'crontab "$tmp"',
      'rm -f "$tmp"',
    ].join('\n');
    const r = await this.executorService.runSystemScript(
      script,
      remoteServerId,
      projectUserId,
    );
    if (!r.success) {
      throw new BadRequestException(
        `Failed to remove crontab entry for cron job ${jobId}: ${r.output}`,
      );
    }
  }

  private async writeRemoteScriptFile(
    remoteServerId: number,
    projectUserId: number,
    jobId: number,
    scriptBody: string,
    envLines: string[],
  ): Promise<void> {
    const scriptPath = this.scriptPathRemote(jobId);
    const envPath = this.envPathRemote(jobId);
    const installScript = buildRemoteEnvAndWrappedShInstallScript({
      parentDirShQuoted: remoteInstallShQuote(this.scriptDirRemote()),
      envPath,
      scriptPath,
      envLines,
      userScriptBody: scriptBody,
      defaults: REMOTE_NOTIFY_DEFAULTS_CRON,
      truncateLogOnStart: true,
      runUserScriptOnHostViaDockerSocket: true,
    });
    const r = await this.executorService.runSystemScript(
      installScript,
      remoteServerId,
      projectUserId,
    );
    if (!r.success) {
      throw new BadRequestException(
        `Failed to write cron script for job ${jobId}: ${r.output}`,
      );
    }
  }

  private async removeRemoteScriptFile(
    remoteServerId: number,
    projectUserId: number,
    jobId: number,
  ): Promise<void> {
    const scriptPath = this.scriptPathRemote(jobId);
    const envPath = this.envPathRemote(jobId);
    const r = await this.executorService.runSystemScript(
      `rm -f ${this.shQuote(scriptPath)} ${this.shQuote(envPath)} || true`,
      remoteServerId,
      projectUserId,
    );
    if (!r.success) {
      throw new BadRequestException(
        `Failed to remove cron script for job ${jobId}: ${r.output}`,
      );
    }
  }

  private async removeCrontabEntry(job: CronJob): Promise<void> {
    const remoteServerId = await this.tryResolveCronRemoteServerId(job);
    if (remoteServerId == null) return;
    await this.removeCrontabEntryForRemote(remoteServerId, job.userId, job.id);
    await this.removeRemoteScriptFile(remoteServerId, job.userId, job.id);
  }

  async readLastRunLog(
    userId: number,
    idOrPublicId: string | number,
    opts?: { lines?: number },
  ): Promise<{ log: string; source: string }> {
    const job = await this.resolveEntity(userId, idOrPublicId);
    if (job.serviceAction !== 'docker_command' || job.remoteServerId == null) {
      return { log: '', source: 'not-applicable' };
    }
    const linesRaw = opts?.lines ?? 200;
    const lines =
      Number.isFinite(linesRaw) && linesRaw > 0 ? Math.min(Math.floor(linesRaw), 2000) : 200;
    const logPath = `${this.scriptDirRemote()}/${job.id}.log`;
    const script = `
set -e
if [ ! -f ${this.shQuote(logPath)} ]; then
  echo ''
  exit 0
fi
if command -v tail >/dev/null 2>&1; then
  tail -n ${lines} ${this.shQuote(logPath)}
else
  cat ${this.shQuote(logPath)}
fi
`;
    const out = await this.executorService.runSystemScript(
      script,
      job.remoteServerId,
      job.userId,
    );
    if (!out.success) {
      throw new BadRequestException(
        `Failed to read cron run log for job "${job.name}": ${out.output}`,
      );
    }
    const normalized = (out.output ?? '').trim() === '(no output)' ? '' : out.output ?? '';
    return { log: normalized, source: 'remote-script-log' };
  }

  private async upsertCrontabEntry(job: CronJob): Promise<void> {
    if (!job.isActive) {
      await this.removeCrontabEntry(job);
      return;
    }
    const remoteServerId = await this.resolveCronRemoteServerId(job);
    if (job.serviceAction !== 'docker_command' || !job.dockerCommand?.trim()) {
      throw new BadRequestException(
        'Cron over SSH currently supports docker_command only. Set action to docker_command and provide a script.',
      );
    }
    const envLines = await this.buildNotificationEnvForJob(job);
    await this.writeRemoteScriptFile(
      remoteServerId,
      job.userId,
      job.id,
      job.dockerCommand,
      envLines,
    );
    const line = this.buildRemoteCrontabLine(job);
    const marker = this.cronMarker(job.id);
    const script = [
      'tmp="$(mktemp)"',
      `( crontab -l 2>/dev/null || true ) | grep -F -v ${this.shQuote(marker)} > "$tmp" || true`,
      `printf '%s\n' ${this.shQuote(line)} >> "$tmp"`,
      'crontab "$tmp"',
      'rm -f "$tmp"',
    ].join('\n');
    const r = await this.executorService.runSystemScript(
      script,
      remoteServerId,
      job.userId,
    );
    if (!r.success) {
      throw new BadRequestException(
        `Failed to install crontab entry for cron job "${job.name}": ${r.output}`,
      );
    }
  }

  private validateCronField(value: string, min: number, max: number): boolean {
    const v = value.trim();
    if (v === '*') return true;
    if (/^\*\/\d+$/.test(v)) {
      const step = Number(v.slice(2));
      return step >= 1 && step <= max;
    }
    if (v.includes(',')) {
      return v.split(',').every((part) => this.validateCronField(part.trim(), min, max));
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(v);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return false;
      return a >= min && b <= max;
    }
    if (/^\d+$/.test(v)) {
      const n = Number(v);
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
    const f = field.trim();
    if (f === '*') return true;
    if (f.startsWith('*/')) {
      const step = Number(f.slice(2));
      return step > 0 && current % step === 0;
    }
    if (f.includes(',')) {
      return f.split(',').some((part) => this.matchesCronField(part.trim(), current));
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(f);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      return current >= a && current <= b;
    }
    if (/^\d+$/.test(f)) {
      return Number(f) === current;
    }
    return false;
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
    channelId: number,
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
        if (dto.serviceAction === 'docker_command') {
          // Docker command cron jobs run as system scripts and may not target a service.
        } else {
        throw new BadRequestException(
          'serviceId is required unless action is no_action.',
        );
        }
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
    const hasNotifyChannel =
      dto.notifyChannelId != null && dto.notifyChannelId >= 1;
    const hasNotifyMessage = Boolean(dto.notifyMessage?.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      throw new BadRequestException(
        'Provide both notifyChannelId and notifyMessage, or leave both empty.',
      );
    }
  }

  private summaryLabel(w: CronJob): string {
    const a = w.serviceAction ?? '—';
    if (a === 'redeploy') return `[Cron ${w.cronExpression}] Redeploy`;
    if (a === 'volume_backup') {
      return `[Cron ${w.cronExpression}] Volume → S3: ${w.volumeSource ?? '—'}`;
    }
    if (a === 'database_backup') {
      const eng = w.databaseBackupConfig?.engine;
      return eng
        ? `[Cron ${w.cronExpression}] Database → S3 (${eng})`
        : `[Cron ${w.cronExpression}] Database → S3`;
    }
    if (a === 'docker_command') return `[Cron ${w.cronExpression}] Docker command`;
    if (a === 'no_action') return `[Cron ${w.cronExpression}] No action`;
    return `[Cron ${w.cronExpression}] ${a}`;
  }

  private async toListRow(w: CronJob): Promise<CronJobListRow> {
    const row = await this.ensurePublicId(w);
    return {
      id: row.id,
      publicId: row.publicId,
      name: row.name,
      description: row.description ?? '',
      isActive: row.isActive,
      cronExpression: row.cronExpression,
      targetMode: row.targetMode,
      serviceId: row.serviceId,
      remoteServerId: row.remoteServerId,
      serviceAction: row.serviceAction,
      notifyOnTrigger: row.notifyOnTrigger,
      createdAt: row.createdAt.toISOString(),
      summary: this.summaryLabel(row),
    };
  }

  private async toDetailRow(w: CronJob): Promise<CronJobDetailRow> {
    const row = await this.ensurePublicId(w);
    const cfg = row.databaseBackupConfig;
    return {
      ...(await this.toListRow(row)),
      volumeSource: row.volumeSource,
      dockerCommand: row.dockerCommand,
      databaseBackupConfig: cfg,
      databaseBackupPreview: cfg ? describeDatabaseBackupPreview(cfg) : null,
      backupS3ProfileName: row.backupS3ProfileName,
      notifyChannelId: row.notifyChannelId,
      notifyMessage: row.notifyMessage,
    };
  }

  private async finalizeBackupWithS3(
    userId: number,
    contextId: number,
    profileName: string | null | undefined,
    r: {
      success: boolean;
      output: string;
      archiveBasename?: string;
      remoteArtifact?: {
        remoteServerId: number;
        projectUserId: number | null;
        stagingDir: string;
        remoteFilePath: string;
      };
    },
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
    const key = `weehawk/backups/u${userId}/${contextId}/${r.archiveBasename}`;
    const ra = r.remoteArtifact;
    if (!ra) {
      return {
        success: false,
        output: `${r.output}\nBackup archive was not created on the deploy host.`,
      };
    }
    try {
      const put = await this.s3Service.presignPutObject(userId, trimmed, key, {
        contentType: r.archiveBasename.toLowerCase().endsWith('.gz')
          ? 'application/gzip'
          : 'application/octet-stream',
      });
      await this.remoteServersService.curlPresignedPutFromRemoteFile(
        ra.remoteServerId,
        ra.projectUserId,
        ra.remoteFilePath,
        put.url,
        put.contentType,
      );
      await this.remoteServersService.removeRemoteTreeBestEffort(
        ra.remoteServerId,
        ra.projectUserId,
        ra.stagingDir,
      );
      return {
        success: true,
        output: `${r.output}\nUploaded to s3://${put.bucket}/${put.key}`,
      };
    } catch (e) {
      await this.remoteServersService.removeRemoteTreeBestEffort(
        ra.remoteServerId,
        ra.projectUserId,
        ra.stagingDir,
      );
      return {
        success: false,
        output: `${r.output}\nS3 upload failed: ${getErrorMessage(e)}`,
      };
    }
  }

  async create(userId: number, dto: CreateCronJobDto): Promise<CronJobDetailRow> {
    this.validateCreate(dto);
    if (dto.notifyChannelId != null && dto.notifyChannelId >= 1) {
      await this.assertNotificationChannel(userId, dto.notifyChannelId);
    }
    if (dto.targetMode === 'service' && dto.serviceId != null) {
      try {
        await this.servicesService.assertServiceOwnedByUser(dto.serviceId, userId);
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

    const job = this.cronJobRepo.create({
      publicId: generatePublicId('crn'),
      userId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      isActive: true,
      cronExpression: dto.cronExpression.trim(),
      targetMode: dto.targetMode,
      serviceId:
        dto.targetMode === 'service' && dto.serviceAction !== 'no_action'
          && dto.serviceAction !== 'docker_command'
          ? dto.serviceId
          : null,
      remoteServerId:
        dto.targetMode === 'service' &&
        dto.serviceAction === 'docker_command' &&
        dto.remoteServerId != null
          ? dto.remoteServerId
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
        dto.notifyChannelId != null &&
        dto.notifyChannelId >= 1 &&
        Boolean(dto.notifyMessage?.trim()),
      notifyChannelId: dto.notifyChannelId ?? null,
      notifyMessage: dto.notifyMessage?.trim() || null,
    });
    const saved = await this.cronJobRepo.save(job);
    this.runRemoteSyncInBackground(`create cron job ${saved.id}`, async () => {
      await this.upsertCrontabEntry(saved);
    });
    return await this.toDetailRow(saved);
  }

  async list(userId: number): Promise<CronJobListRow[]> {
    const list = await this.cronJobRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(list.map((w) => this.toListRow(w)));
  }

  async findOne(userId: number, idOrPublicId: string | number): Promise<CronJobDetailRow> {
    const job = await this.resolveEntity(userId, idOrPublicId);
    return await this.toDetailRow(job);
  }

  async update(
    userId: number,
    idOrPublicId: string | number,
    dto: UpdateCronJobDto,
  ): Promise<CronJobDetailRow> {
    const job = await this.resolveEntity(userId, idOrPublicId);
    const previousJob = this.cronJobRepo.create({ ...job });

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
      job.notifyChannelId = dto.notifyChannelId;
    }
    if (dto.notifyMessage !== undefined) {
      job.notifyMessage = dto.notifyMessage?.trim() || null;
    }
    if (dto.backupS3ProfileName !== undefined) {
      const v = dto.backupS3ProfileName?.trim() || null;
      if (v) {
        await this.s3Service.assertProfileExists(v);
      }
      if (
        (job.serviceAction === 'volume_backup' ||
          job.serviceAction === 'database_backup') &&
        !v
      ) {
        throw new BadRequestException(
          'S3 destination is required for backup actions.',
        );
      }
      job.backupS3ProfileName = v;
    }
    if (dto.databaseBackupConfig !== undefined) {
      if (job.serviceAction === 'database_backup') {
        if (!dto.databaseBackupConfig) {
          throw new BadRequestException(
            'databaseBackupConfig is required for database backup.',
          );
        }
        job.databaseBackupConfig =
          dto.databaseBackupConfig as unknown as DatabaseBackupConfig;
        job.dockerCommand = null;
      }
    }
    if (dto.dockerCommand !== undefined) {
      if (job.serviceAction === 'docker_command') {
        job.dockerCommand = dto.dockerCommand?.trim() || null;
      }
    }
    if (dto.remoteServerId !== undefined) {
      if (job.serviceAction === 'docker_command') {
        job.remoteServerId = dto.remoteServerId ?? null;
      } else {
        job.remoteServerId = null;
      }
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
    const prevRemoteId = await this.tryResolveCronRemoteServerId(previousJob);
    const nextRemoteId = await this.tryResolveCronRemoteServerId(saved);
    this.runRemoteSyncInBackground(`update cron job ${saved.id}`, async () => {
      if (prevRemoteId != null && (nextRemoteId == null || prevRemoteId !== nextRemoteId)) {
        await this.removeCrontabEntryForRemote(prevRemoteId, previousJob.userId, saved.id);
      }
      await this.upsertCrontabEntry(saved);
    });
    return await this.toDetailRow(saved);
  }

  async remove(userId: number, idOrPublicId: string | number): Promise<void> {
    const existing = await this.resolveEntity(userId, idOrPublicId);
    await this.removeCrontabEntry(existing);
    const res = await this.cronJobRepo.delete({ id: existing.id, userId });
    if (!res.affected) throw new NotFoundException('Cron job not found');
  }

  private async execute(
    job: CronJob,
  ): Promise<{ success: boolean; output: string; action: string }> {
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
            { actingUserId: job.userId },
          );
          success = Boolean(r.success);
          output = String(r.output ?? '');
        } else if (
          job.serviceAction === 'volume_backup' &&
          job.volumeSource &&
          job.serviceId != null
        ) {
          action = 'volume_backup';
          if (!job.backupS3ProfileName?.trim()) {
            success = false;
            output =
              'S3 destination is not configured. Edit the cron job and choose a saved S3 profile.';
          } else {
            try {
              const ssh = await this.servicesService.getDockerSshTargetIds(job.serviceId);
              if (ssh.remoteServerId == null) {
                success = false;
                output =
                  'This service has no deploy host; volume backup runs on the remote Docker machine. Set Remote Docker host on the service.';
              } else {
                const r = await this.executorService.backupDockerVolume(
                  job.volumeSource,
                  ssh.remoteServerId,
                  null,
                );
                const final = await this.finalizeBackupWithS3(
                  job.userId,
                  job.id,
                  job.backupS3ProfileName,
                  r,
                );
                success = final.success;
                output = final.output;
              }
            } catch (e) {
              success = false;
              output = getErrorMessage(e);
            }
          }
        } else if (job.serviceAction === 'database_backup' && job.serviceId != null) {
          action = 'database_backup';
          if (!job.backupS3ProfileName?.trim()) {
            success = false;
            output =
              'S3 destination is not configured. Edit the cron job and choose a saved S3 profile.';
          } else if (job.databaseBackupConfig) {
            try {
              const r = await this.executorService.backupDatabaseStructured(
                job.serviceId,
                job.databaseBackupConfig,
              );
              const final = await this.finalizeBackupWithS3(
                job.userId,
                job.id,
                job.backupS3ProfileName,
                r,
              );
              success = final.success;
              output = final.output;
            } catch (e) {
              success = false;
              output = getErrorMessage(e);
            }
          } else if (job.dockerCommand) {
            try {
              const r = await this.executorService.backupDatabaseFromDockerCommand(
                job.serviceId,
                job.dockerCommand,
                '',
              );
              const final = await this.finalizeBackupWithS3(
                job.userId,
                job.id,
                job.backupS3ProfileName,
                r,
              );
              success = final.success;
              output = final.output;
            } catch (e) {
              success = false;
              output = getErrorMessage(e);
            }
          } else {
            success = false;
            output =
              'Database backup is not configured (missing databaseBackupConfig).';
          }
        } else if (
          job.serviceAction === 'docker_command' &&
          job.dockerCommand
        ) {
          action = 'docker_command';
          const r = await this.executorService.runSystemScript(
            `/bin/bash ${this.shQuote(this.scriptPathRemote(job.id))}`,
            job.remoteServerId,
            job.userId,
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
          normalizeRemoteNotificationMessage(job.notifyMessage),
        );
      } catch {
        // best effort
      }
    }
    return { success, output, action };
  }

  async triggerNow(
    userId: number,
    idOrPublicId: string | number,
  ): Promise<{ ok: boolean; success: boolean; action: string; output: string }> {
    const job = await this.resolveEntity(userId, idOrPublicId);
    if (!job.isActive) {
      throw new BadRequestException('Cron job is inactive.');
    }
    const result = await this.execute(job);
    return {
      ok: result.success,
      success: result.success,
      action: result.action,
      output: result.output,
    };
  }

  async runDueCronJobs(): Promise<void> {
    // Deprecated path: cron execution now uses Linux crontab + SSH-triggered HTTP callbacks.
    return;
  }
}
