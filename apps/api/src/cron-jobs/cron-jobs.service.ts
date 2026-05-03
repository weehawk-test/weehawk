import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { resolveOrganizationInternalIdForMember } from '../common/organization-workspace-scope';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';
import { NotificationService } from '../notifications/notification.service';
import {
  buildRemoteEnvAndWrappedShInstallScript,
  buildRemoteNotificationEnvLinesFromChannel,
  normalizeRemoteNotificationMessage,
  remoteInstallShQuote,
  REMOTE_NOTIFY_DEFAULTS_CRON,
} from '../common/remote-wrapped-script-install';
import { ExecutorService } from '../executor/executor.service';
import { RemoteServersService } from '../remote-servers/remote-servers.service';
import { getErrorMessage } from '../utils/error-message';
import { CreateCronJobDto } from './dto/create-cron-job.dto';
import { UpdateCronJobDto } from './dto/update-cron-job.dto';
import { CronJob } from './entities/cron-job.entity';
import { generatePublicId } from '../common/public-id';
import { RemoteServerTenantScopedRepository } from '../common/tenant-scoped.service';

export type CronJobListRow = {
  id: number;
  publicId: string;
  name: string;
  description: string;
  isActive: boolean;
  cronExpression: string;
  remoteServerId: number;
  notifyOnTrigger: boolean;
  createdAt: string;
  summary: string;
};

export type CronJobDetailRow = CronJobListRow & {
  bashScript: string;
  notifyChannelId: number | null;
  notifyMessage: string | null;
};

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);
  private readonly scopedCronJobs: RemoteServerTenantScopedRepository<CronJob>;

  constructor(
    @InjectRepository(CronJob)
    private readonly cronJobRepo: Repository<CronJob>,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepo: Repository<OrganizationMembership>,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationService,
    private readonly remoteServersService: RemoteServersService,
  ) {
    this.scopedCronJobs = new RemoteServerTenantScopedRepository<CronJob>(
      this.cronJobRepo,
      this.membershipRepo,
      'Cron job',
    );
  }

  private async workspaceOrgId(
    userId: number,
    organizationPublicId?: string | null,
  ): Promise<number | null> {
    return resolveOrganizationInternalIdForMember(
      this.organizationsRepository,
      userId,
      organizationPublicId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.CRON_JOBS },
    );
  }

  private assertCronWorkspace(
    job: CronJob,
    organizationPublicId: string | null | undefined,
    expectedOrgId: number | null,
  ): void {
    const raw = organizationPublicId?.trim();
    if (!raw) return;
    const rowOrg = job.organizationId ?? null;
    if (rowOrg !== expectedOrgId) {
      throw new NotFoundException('Cron job not found');
    }
  }

  private runRemoteSyncInBackground(
    taskLabel: string,
    run: () => Promise<void>,
  ): void {
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
    return this.scopedCronJobs.saveScoped(row, row.userId);
  }

  private async resolveEntity(
    userId: number,
    idOrPublicId: string | number,
  ): Promise<CronJob> {
    const raw = String(idOrPublicId).trim();
    if (/^\d+$/.test(raw)) {
      const row = await this.scopedCronJobs.findScoped(Number(raw), userId);
      return this.ensurePublicId(row);
    }
    const row = await this.scopedCronJobs.findScopedBy('publicId', raw, userId);
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
    if (!job.bashScript?.trim()) {
      throw new BadRequestException(
        'Cron job must have a bash script for Linux crontab execution.',
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
    if (job.remoteServerId == null) {
      throw new BadRequestException(
        `Cron job "${job.name}" needs a remote deploy server to install Linux crontab via SSH.`,
      );
    }
    await this.remoteServersService.assertDeployServerById(
      job.remoteServerId,
      job.userId,
    );
    return job.remoteServerId;
  }

  private async tryResolveCronRemoteServerId(
    job: CronJob,
  ): Promise<number | null> {
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
    opts?: { lines?: number; organizationPublicId?: string | null },
  ): Promise<{ log: string; source: string }> {
    const expectedOrg = await this.workspaceOrgId(
      userId,
      opts?.organizationPublicId,
    );
    const job = await this.resolveEntity(userId, idOrPublicId);
    this.assertCronWorkspace(job, opts?.organizationPublicId, expectedOrg);
    if (job.remoteServerId == null) {
      return { log: '', source: 'not-applicable' };
    }
    const linesRaw = opts?.lines ?? 200;
    const lines =
      Number.isFinite(linesRaw) && linesRaw > 0
        ? Math.min(Math.floor(linesRaw), 2000)
        : 200;
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
      userId,
    );
    if (!out.success) {
      throw new BadRequestException(
        `Failed to read cron run log for job "${job.name}": ${out.output}`,
      );
    }
    const normalized =
      (out.output ?? '').trim() === '(no output)' ? '' : (out.output ?? '');
    return { log: normalized, source: 'remote-script-log' };
  }

  private async upsertCrontabEntry(job: CronJob): Promise<void> {
    if (!job.isActive) {
      await this.removeCrontabEntry(job);
      return;
    }
    const remoteServerId = await this.resolveCronRemoteServerId(job);
    if (!job.bashScript?.trim()) {
      throw new BadRequestException(
        'Cron job must have a bash script to install on the deploy host.',
      );
    }
    const envLines = await this.buildNotificationEnvForJob(job);
    await this.writeRemoteScriptFile(
      remoteServerId,
      job.userId,
      job.id,
      job.bashScript,
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
      return v
        .split(',')
        .every((part) => this.validateCronField(part.trim(), min, max));
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

  private async assertNotificationChannel(
    userId: number,
    channelId: number,
    organizationPublicId?: string | null,
  ): Promise<void> {
    const rows = await this.notificationsService.listChannels(
      userId,
      organizationPublicId,
    );
    if (!rows.some((c) => c.id === channelId)) {
      throw new BadRequestException('Notification channel not found.');
    }
  }

  private validateCreate(dto: CreateCronJobDto): void {
    if (!this.isValidCronExpression(dto.cronExpression)) {
      throw new BadRequestException('Invalid cron expression.');
    }
    if (!dto.bashScript?.trim()) {
      throw new BadRequestException('bashScript is required.');
    }
    if (dto.remoteServerId == null || dto.remoteServerId < 1) {
      throw new BadRequestException('remoteServerId is required.');
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
    return `[Cron ${w.cronExpression}] Bash on deploy host`;
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
      remoteServerId: row.remoteServerId,
      notifyOnTrigger: row.notifyOnTrigger,
      createdAt: row.createdAt.toISOString(),
      summary: this.summaryLabel(row),
    };
  }

  private async toDetailRow(w: CronJob): Promise<CronJobDetailRow> {
    const row = await this.ensurePublicId(w);
    return {
      ...(await this.toListRow(row)),
      bashScript: row.bashScript,
      notifyChannelId: row.notifyChannelId,
      notifyMessage: row.notifyMessage,
    };
  }

  async create(
    userId: number,
    dto: CreateCronJobDto,
  ): Promise<CronJobDetailRow> {
    this.validateCreate(dto);
    const orgId = await this.workspaceOrgId(userId, dto.organizationPublicId);
    if (dto.notifyChannelId != null && dto.notifyChannelId >= 1) {
      await this.assertNotificationChannel(
        userId,
        dto.notifyChannelId,
        dto.organizationPublicId,
      );
    }
    await this.remoteServersService.assertDeployServerById(
      dto.remoteServerId,
      userId,
    );

    const job = this.cronJobRepo.create({
      publicId: generatePublicId('crn'),
      userId,
      organizationId: orgId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      isActive: true,
      cronExpression: dto.cronExpression.trim(),
      remoteServerId: dto.remoteServerId,
      bashScript: dto.bashScript.trim(),
      notifyOnTrigger:
        dto.notifyChannelId != null &&
        dto.notifyChannelId >= 1 &&
        Boolean(dto.notifyMessage?.trim()),
      notifyChannelId: dto.notifyChannelId ?? null,
      notifyMessage: dto.notifyMessage?.trim() || null,
    });
    const saved = await this.scopedCronJobs.saveScoped(job, userId);
    this.runRemoteSyncInBackground(`create cron job ${saved.id}`, async () => {
      await this.upsertCrontabEntry(saved);
    });
    return await this.toDetailRow(saved);
  }

  async list(
    userId: number,
    organizationPublicId?: string | null,
  ): Promise<CronJobListRow[]> {
    const orgId = await this.workspaceOrgId(userId, organizationPublicId);
    const list =
      orgId != null
        ? await this.scopedCronJobs.listForOrganization(userId, orgId, {
            order: { createdAt: 'DESC' },
          })
        : await this.scopedCronJobs.listPersonal(userId, {
            order: { createdAt: 'DESC' },
          });
    return Promise.all(list.map((w) => this.toListRow(w)));
  }

  async findOne(
    userId: number,
    idOrPublicId: string | number,
    organizationPublicId?: string | null,
  ): Promise<CronJobDetailRow> {
    const expectedOrg = await this.workspaceOrgId(userId, organizationPublicId);
    const job = await this.resolveEntity(userId, idOrPublicId);
    this.assertCronWorkspace(job, organizationPublicId, expectedOrg);
    return await this.toDetailRow(job);
  }

  async update(
    userId: number,
    idOrPublicId: string | number,
    dto: UpdateCronJobDto,
    organizationPublicId?: string | null,
  ): Promise<CronJobDetailRow> {
    const expectedOrg = await this.workspaceOrgId(userId, organizationPublicId);
    const job = await this.resolveEntity(userId, idOrPublicId);
    this.assertCronWorkspace(job, organizationPublicId, expectedOrg);
    const previousJob = this.cronJobRepo.create({ ...job });

    if (dto.name !== undefined) job.name = dto.name.trim();
    if (dto.description !== undefined)
      job.description = dto.description.trim() || null;
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
    if (dto.bashScript !== undefined) {
      job.bashScript = dto.bashScript?.trim() ?? '';
    }
    if (dto.remoteServerId !== undefined) {
      job.remoteServerId = dto.remoteServerId;
    }

    if (!job.bashScript?.trim()) {
      throw new BadRequestException('bashScript cannot be empty.');
    }
    if (job.remoteServerId == null || job.remoteServerId < 1) {
      throw new BadRequestException('remoteServerId is required.');
    }

    if (job.notifyChannelId && job.notifyMessage) {
      job.notifyOnTrigger = true;
      await this.assertNotificationChannel(
        userId,
        job.notifyChannelId,
        organizationPublicId,
      );
    } else if (!job.notifyChannelId && !job.notifyMessage) {
      job.notifyOnTrigger = false;
    } else {
      throw new BadRequestException(
        'Provide both notifyChannelId and notifyMessage, or clear both.',
      );
    }

    await this.remoteServersService.assertDeployServerById(
      job.remoteServerId,
      userId,
    );

    const saved = await this.scopedCronJobs.saveScoped(job, userId);
    const prevRemoteId = await this.tryResolveCronRemoteServerId(previousJob);
    const nextRemoteId = await this.tryResolveCronRemoteServerId(saved);
    this.runRemoteSyncInBackground(`update cron job ${saved.id}`, async () => {
      if (
        prevRemoteId != null &&
        (nextRemoteId == null || prevRemoteId !== nextRemoteId)
      ) {
        await this.removeCrontabEntryForRemote(
          prevRemoteId,
          previousJob.userId,
          saved.id,
        );
      }
      await this.upsertCrontabEntry(saved);
    });
    return await this.toDetailRow(saved);
  }

  async remove(
    userId: number,
    idOrPublicId: string | number,
    organizationPublicId?: string | null,
  ): Promise<void> {
    const expectedOrg = await this.workspaceOrgId(userId, organizationPublicId);
    const existing = await this.resolveEntity(userId, idOrPublicId);
    this.assertCronWorkspace(existing, organizationPublicId, expectedOrg);
    await this.removeCrontabEntry(existing);
    await this.scopedCronJobs.deleteScoped(existing.id, userId);
  }

  private async execute(
    job: CronJob,
  ): Promise<{ success: boolean; output: string; action: string }> {
    let action = 'none';
    let success = true;
    let output = '';

    try {
      if (job.bashScript?.trim() && job.remoteServerId != null) {
        action = 'bash_script';
        const r = await this.executorService.runSystemScript(
          `/bin/bash ${this.shQuote(this.scriptPathRemote(job.id))}`,
          job.remoteServerId,
          job.userId,
        );
        success = r.success;
        output = r.output;
      } else {
        success = false;
        output = 'Cron job is misconfigured (missing script or deploy server).';
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
    organizationPublicId?: string | null,
  ): Promise<{
    ok: boolean;
    success: boolean;
    action: string;
    output: string;
  }> {
    const expectedOrg = await this.workspaceOrgId(userId, organizationPublicId);
    const job = await this.resolveEntity(userId, idOrPublicId);
    this.assertCronWorkspace(job, organizationPublicId, expectedOrg);
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
    return;
  }
}
