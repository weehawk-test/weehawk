import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { Like, Repository } from 'typeorm';
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
import {
  RemoteServersService,
  WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR,
} from '../remote-servers/remote-servers.service';
import { buildRemoteNotificationEnvLinesFromChannel } from '../common/remote-wrapped-script-install';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { Webhook, type WebhookRemoteTriggerUrlScheme } from './entities/webhook.entity';
import { deriveHooksPublicHost } from './hooks-public-host';
import {
  buildOnHostRedeployScriptBody,
  looksLikeGeneratedOnHostRedeployScript,
  onHostWebhookBundleEnvLines,
} from '../common/on-host-redeploy-script';

export type WebhookListRow = {
  id: number;
  name: string;
  description: string;
  isActive: boolean;
  targetMode: string;
  serviceId: number | null;
  remoteServerId: number | null;
  serviceAction: string | null;
  notifyOnTrigger: boolean;
  createdAt: string;
  summary: string;
  secretToken: string;
  remoteTriggerUrl: string | null;
  /** Traefik hostname for the Swarm webhook agent when configured. */
  hooksPublicHost: string | null;
  /** http/https prefix for the remote trigger URL when the action is docker_command. */
  remoteTriggerUrlScheme: WebhookRemoteTriggerUrlScheme;
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
  /** When script runs on a remote server: URL for the on-host agent (e.g. Go) at that server’s IP. */
  remoteTriggerUrl: string | null;
};

@Injectable()
export class WebhooksService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationService,
    private readonly s3Service: S3Service,
    private readonly remoteServersService: RemoteServersService,
  ) {}

  /** Deploy hosts cannot reach the developer machine via localhost; never persist loopback as callback origin. */
  private isLoopbackApiHostname(hostname: string): boolean {
    const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '::1' ||
      h === '0:0:0:0:0:0:0:1'
    );
  }

  /** Normalize optional client-supplied API origin (no path). */
  private normalizeHooksTriggerOriginInput(
    raw: string | undefined | null,
  ): string | null {
    const t = raw?.trim();
    if (!t) {
      return null;
    }
    try {
      const u = new URL(/:\/\//.test(t) ? t : `http://${t}`);
      if (this.isLoopbackApiHostname(u.hostname)) {
        return null;
      }
      if (u.pathname !== '/' && u.pathname !== '') {
        throw new BadRequestException(
          'hooksTriggerOrigin must be an origin only (e.g. https://api.example.com:8080), without a path.',
        );
      }
      return u.origin;
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      throw new BadRequestException(
        'hooksTriggerOrigin must be a valid http(s) URL.',
      );
    }
  }

  /** One-time style backfill: older auto redeploy rows had no flag; align them with new creates. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const legacy = await this.webhookRepo.find({
        where: {
          serviceAction: 'docker_command',
          name: Like('Redeploy ·%'),
          hiddenFromWebhooksList: false,
        },
      });
      for (const w of legacy) {
        w.hiddenFromWebhooksList = true;
      }
      if (legacy.length > 0) {
        await this.webhookRepo.save(legacy);
      }
    } catch {
      /* ignore if schema not ready */
    }
  }

  /** Notification lines + optional Weehawk bundle segment env (sourced before the user script on the remote host). */
  private async mergeRemoteWebhookNotificationAndBundleEnv(
    userId: number,
    notifyOnTrigger: boolean,
    notifyChannelId: string | null | undefined,
    notifyMessage: string | null | undefined,
    serviceId: number | null | undefined,
  ): Promise<string[]> {
    const base = await this.buildRemoteWebhookNotificationEnvLines(
      userId,
      notifyOnTrigger,
      notifyChannelId,
      notifyMessage,
    );
    if (serviceId == null || serviceId < 1) {
      return base;
    }
    try {
      const svc = await this.servicesService.findOne(serviceId);
      const autoDeploy = await this.resolveAutoDeployCloneInfo(serviceId);
      return [...base, ...onHostWebhookBundleEnvLines(svc, autoDeploy)];
    } catch {
      return base;
    }
  }

  /**
   * If the service has auto-deploy enabled, resolve clone credentials so the
   * remote bash script can `git clone` private (and public) repos without the API.
   *
   * - **GitLab**: returns authenticated HTTPS URL (long-lived token embedded).
   * - **GitHub**: returns plain URL + App credentials (appId, installationId, PEM)
   *   so the bash script can generate a fresh installation token on every run.
   */
  private async resolveAutoDeployCloneInfo(
    serviceId: number | null | undefined,
  ): Promise<{
    cloneUrl: string;
    branch: string;
    githubAppId?: string;
    githubInstallationId?: string;
    githubPrivateKeyPem?: string;
    gitlabProjectId?: string;
    gitlabApiBase?: string;
    gitlabPrivateToken?: string;
  } | null> {
    if (!serviceId || serviceId < 1) return null;
    try {
      const svc = await this.servicesService.findOne(serviceId);
      if (
        !svc.autoDeployEnabled ||
        !svc.autoDeployGitProvider ||
        !svc.autoDeployRepoId
      ) {
        return null;
      }
      const provider = svc.autoDeployGitProvider;
      const repoId = svc.autoDeployRepoId;
      const branch = svc.autoDeployBranch || 'main';

      if (provider === 'github') {
        const sep = repoId.indexOf(':');
        const installIdStr = sep >= 0 ? repoId.slice(0, sep) : '';
        const fullName = sep >= 0 ? repoId.slice(sep + 1) : repoId;
        const cloneUrl = `https://github.com/${fullName}.git`;
        const ghCreds = await this.servicesService.getGithubAppCredentials();
        if (ghCreds && installIdStr) {
          return {
            cloneUrl,
            branch,
            githubAppId: ghCreds.appId,
            githubInstallationId: installIdStr,
            githubPrivateKeyPem: ghCreds.privateKeyPem,
          };
        }
        return { cloneUrl, branch };
      }
      if (provider === 'gitlab') {
        const projectId = parseInt(repoId, 10);
        if (!Number.isFinite(projectId)) {
          try {
            const authUrl = await this.servicesService.resolveGitlabAuthenticatedUrl(repoId);
            return { cloneUrl: authUrl, branch };
          } catch {
            return { cloneUrl: repoId, branch };
          }
        }
        try {
          const url = await this.servicesService.resolveGitlabProjectCloneUrl(projectId);
          if (url) {
            const glApi =
              await this.servicesService.getGitlabArchiveApiCredentials();
            if (glApi) {
              return {
                cloneUrl: url,
                branch,
                gitlabProjectId: String(projectId),
                gitlabApiBase: glApi.apiBase,
                gitlabPrivateToken: glApi.privateToken,
              };
            }
            return { cloneUrl: url, branch };
          }
        } catch { /* fall through */ }
        return null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private validateCreate(dto: CreateWebhookDto): void {
    if (dto.targetMode === 'service') {
      if (dto.serviceAction == null) {
        throw new BadRequestException(
          'Service webhooks require serviceAction.',
        );
      }
      if (dto.serviceAction !== 'no_action' && dto.serviceId == null) {
        if (dto.serviceAction !== 'docker_command') {
          throw new BadRequestException(
            'serviceId is required unless action is no_action.',
          );
        }
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
      if (dto.serviceAction === 'docker_command') {
        if (dto.remoteServerId == null || dto.remoteServerId < 1) {
          throw new BadRequestException(
            'A deploy remote server is required for bash webhooks.',
          );
        }
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
    if (dto.serviceAction === 'docker_command') {
      this.assertPlausibleHooksPublicHost(
        this.resolveHooksPublicHostForStorage(dto.hooksPublicHost),
      );
    }
  }

  /** Resolves optional user domain to stored Traefik host {@code weehawk-webhook.<domain>}. */
  private resolveHooksPublicHostForStorage(
    raw: string | null | undefined,
  ): string | null {
    if (raw == null || !String(raw).trim()) {
      return null;
    }
    return deriveHooksPublicHost(String(raw).trim());
  }

  private normalizeRemoteTriggerUrlScheme(
    raw: string | null | undefined,
  ): WebhookRemoteTriggerUrlScheme {
    const t = String(raw ?? 'http').trim().toLowerCase();
    return t === 'https' ? 'https' : 'http';
  }

  private assertPlausibleHooksPublicHost(raw: string | null | undefined): void {
    if (raw == null || !String(raw).trim()) {
      return;
    }
    const t = String(raw).trim();
    if (t.length > 253) {
      throw new BadRequestException('hooksPublicHost is too long.');
    }
    if (/[\s\/:]/.test(t)) {
      throw new BadRequestException(
        'hooksPublicHost must be a hostname only (no scheme, port, or path). Example: example.com → weehawk-webhook.example.com',
      );
    }
    if (
      !/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(
        t,
      )
    ) {
      throw new BadRequestException('hooksPublicHost does not look like a valid hostname.');
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

  /** Env file beside the remote `.sh`, same pattern as cron jobs (`send_notification` + EXIT trap). */
  private async buildRemoteWebhookNotificationEnvLines(
    userId: number,
    notifyOnTrigger: boolean,
    notifyChannelId: string | null | undefined,
    notifyMessage: string | null | undefined,
  ): Promise<string[]> {
    if (!notifyOnTrigger || !notifyChannelId || !notifyMessage?.trim()) {
      return buildRemoteNotificationEnvLinesFromChannel(false, null, null);
    }
    const ch = await this.notificationsService.getChannelRuntimeConfig(
      userId,
      notifyChannelId,
    );
    return buildRemoteNotificationEnvLinesFromChannel(true, ch, notifyMessage);
  }

  private async collectHooksPublicHostsForRemoteServer(
    remoteServerId: number,
  ): Promise<string[]> {
    const rows = await this.webhookRepo.find({
      where: { remoteServerId, serviceAction: 'docker_command' },
      select: ['hooksPublicHost'],
    });
    const out = new Set<string>();
    for (const r of rows) {
      const h = r.hooksPublicHost?.trim().toLowerCase();
      if (h) out.add(h);
    }
    return [...out].sort();
  }

  private async mergeHooksPublicHostsForRemoteCreate(
    remoteServerId: number,
    extraHost: string | null | undefined,
  ): Promise<string[]> {
    const fromDb = await this.collectHooksPublicHostsForRemoteServer(remoteServerId);
    const merged = new Set(fromDb);
    const t = extraHost?.trim().toLowerCase();
    if (t) merged.add(t);
    return [...merged].sort();
  }

  private async syncWebhookAgentForRemoteServer(
    remoteServerId: number | null | undefined,
    userId: number,
  ): Promise<void> {
    if (remoteServerId == null || remoteServerId < 1) {
      return;
    }
    const hosts = await this.collectHooksPublicHostsForRemoteServer(remoteServerId);
    await this.remoteServersService.ensureRemoteWebhookListening(remoteServerId, userId, hosts);
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

  private baseListFields(w: Webhook): Omit<WebhookListRow, 'remoteTriggerUrl'> {
    return {
      id: w.id,
      name: w.name,
      description: w.description ?? '',
      isActive: w.isActive,
      targetMode: w.targetMode,
      serviceId: w.serviceId,
      remoteServerId: w.remoteServerId,
      serviceAction: w.serviceAction,
      notifyOnTrigger: w.notifyOnTrigger,
      createdAt: w.createdAt.toISOString(),
      summary: this.summaryLabel(w),
      secretToken: w.secretToken,
      hooksPublicHost: w.hooksPublicHost ?? null,
      remoteTriggerUrlScheme: this.normalizeRemoteTriggerUrlScheme(w.remoteTriggerUrlScheme),
    };
  }

  private async toListRow(userId: number, w: Webhook): Promise<WebhookListRow> {
    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, w);
    return {
      ...this.baseListFields(w),
      remoteTriggerUrl,
    };
  }

  private toDetailRow(w: Webhook, remoteTriggerUrl: string | null = null): WebhookDetailRow {
    const cfg = w.databaseBackupConfig;
    return {
      ...this.baseListFields(w),
      remoteTriggerUrl,
      volumeSource: w.volumeSource,
      dockerCommand: w.dockerCommand,
      databaseBackupConfig: cfg,
      databaseBackupPreview: cfg ? describeDatabaseBackupPreview(cfg) : null,
      backupS3ProfileName: w.backupS3ProfileName,
      notifyChannelId: w.notifyChannelId,
      notifyMessage: w.notifyMessage,
    };
  }

  /**
   * Auto “Redeploy · …” service webhooks should run the same path as the Services Redeploy button
   * ({@link ServicesService.executeDeployment}), even if the stored bash body is an older template.
   */
  private shouldRunExecutorRedeployForDockerWebhook(w: Webhook): boolean {
    if (w.serviceId == null || w.serviceId < 1) {
      return false;
    }
    if (looksLikeGeneratedOnHostRedeployScript(w.dockerCommand)) {
      return true;
    }
    return typeof w.name === 'string' && w.name.startsWith('Redeploy ·');
  }

  private async resolveRemoteTriggerUrl(
    userId: number,
    w: Webhook,
  ): Promise<string | null> {
    if (
      w.serviceAction !== 'docker_command' ||
      w.remoteServerId == null ||
      !w.dockerCommand?.trim()
    ) {
      return null;
    }
    /** Public trigger URL is always the deploy-host agent (Traefik hostname or IP:port), not the API origin. */
    const scheme = this.normalizeRemoteTriggerUrlScheme(w.remoteTriggerUrlScheme);
    const publicHost = w.hooksPublicHost?.trim();
    if (publicHost) {
      return this.remoteServersService.formatRemoteWebhookTriggerUrlFromPublicHost(
        publicHost,
        w.secretToken,
        scheme,
      );
    }
    try {
      const rs = await this.remoteServersService.findOne(w.remoteServerId, userId);
      return this.remoteServersService.formatRemoteWebhookHttpTriggerUrlFromSafe(
        rs,
        w.secretToken,
        scheme,
      );
    } catch {
      return null;
    }
  }

  private async finalizeBackupWithS3(
    userId: number,
    contextId: number,
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
        userId,
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
    if (
      dto.targetMode === 'service' &&
      dto.serviceAction === 'docker_command' &&
      dto.remoteServerId != null
    ) {
      await this.remoteServersService.assertDeployServerById(dto.remoteServerId, userId);
    }
    if (dto.notifyChannelId) {
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

    const secretToken = randomBytes(32).toString('hex');
    const notifyOnTriggerCreate =
      Boolean(dto.notifyChannelId?.trim()) &&
      Boolean(dto.notifyMessage?.trim());
    const hooksPublicStored =
      dto.serviceAction === 'docker_command'
        ? this.resolveHooksPublicHostForStorage(dto.hooksPublicHost)
        : null;
    const hooksTriggerOriginNormalized =
      dto.targetMode === 'service' && dto.serviceAction === 'docker_command'
        ? this.normalizeHooksTriggerOriginInput(dto.hooksTriggerOrigin)
        : null;
    let resolvedDockerCommand = dto.dockerCommand?.trim() ?? '';
    if (
      dto.serviceId != null &&
      dto.serviceAction === 'docker_command' &&
      resolvedDockerCommand &&
      looksLikeGeneratedOnHostRedeployScript(resolvedDockerCommand)
    ) {
      try {
        const svc = await this.servicesService.findOne(dto.serviceId);
        resolvedDockerCommand = buildOnHostRedeployScriptBody(svc);
      } catch {
        /* keep client body */
      }
    }

    if (
      dto.targetMode === 'service' &&
      dto.serviceAction === 'docker_command' &&
      dto.remoteServerId != null &&
      resolvedDockerCommand
    ) {
      const mergedHosts = await this.mergeHooksPublicHostsForRemoteCreate(
        dto.remoteServerId,
        hooksPublicStored,
      );
      await this.remoteServersService.ensureRemoteWebhookListening(
        dto.remoteServerId,
        userId,
        mergedHosts,
      );
      const notificationEnvLines = await this.mergeRemoteWebhookNotificationAndBundleEnv(
        userId,
        notifyOnTriggerCreate,
        dto.notifyChannelId,
        dto.notifyMessage,
        dto.serviceId ?? null,
      );
      await this.remoteServersService.writeRemoteWebhookScript(
        dto.remoteServerId,
        userId,
        secretToken,
        resolvedDockerCommand,
        notificationEnvLines,
      );
    }

    const w = this.webhookRepo.create({
      userId,
      secretToken,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      isActive: true,
      targetMode: dto.targetMode,
      serviceId:
        dto.targetMode === 'service' && dto.serviceAction !== 'no_action'
          ? dto.serviceId ?? null
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
        resolvedDockerCommand
          ? resolvedDockerCommand
          : null,
      databaseBackupConfig:
        dto.targetMode === 'service' &&
        dto.serviceAction === 'database_backup' &&
        dto.databaseBackupConfig
          ? (dto.databaseBackupConfig as unknown as DatabaseBackupConfig)
          : null,
      backupS3ProfileName: backupProfile,
      notifyOnTrigger: notifyOnTriggerCreate,
      notifyChannelId: dto.notifyChannelId?.trim() || null,
      notifyMessage: dto.notifyMessage?.trim() || null,
      hooksPublicHost: hooksPublicStored,
      remoteTriggerUrlScheme:
        dto.targetMode === 'service' && dto.serviceAction === 'docker_command'
          ? this.normalizeRemoteTriggerUrlScheme(dto.remoteTriggerUrlScheme)
          : 'http',
      hooksTriggerOrigin: hooksTriggerOriginNormalized,
      hiddenFromWebhooksList: dto.hiddenFromWebhooksList === true,
    });
    const saved = await this.webhookRepo.save(w);
    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, saved);
    return this.toDetailRow(saved, remoteTriggerUrl);
  }

  /**
   * After a remote deploy (or mirror sync), re-upload on-host redeploy `.sh` files so paths match
   * the current `appName` / compose type. Only touches webhooks that still look like the generated template.
   */
  async refreshGeneratedOnHostRedeployScriptsForService(serviceId: number): Promise<void> {
    const service = await this.servicesService.findOne(serviceId);
    const canonical = buildOnHostRedeployScriptBody(service);
    const rows = await this.webhookRepo.find({
      where: {
        serviceId,
        serviceAction: 'docker_command',
      },
    });
    const userId = service.project?.userId ?? 0;
    for (const w of rows) {
      if (w.remoteServerId == null) continue;
      if (!looksLikeGeneratedOnHostRedeployScript(w.dockerCommand)) continue;
      w.dockerCommand = canonical;
      await this.webhookRepo.save(w);
      const notificationEnvLines = await this.mergeRemoteWebhookNotificationAndBundleEnv(
        userId,
        w.notifyOnTrigger,
        w.notifyChannelId,
        w.notifyMessage,
        w.serviceId,
      );
      await this.remoteServersService.writeRemoteWebhookScript(
        w.remoteServerId,
        userId,
        w.secretToken,
        canonical,
        notificationEnvLines,
      );
    }
  }

  async list(
    userId: number,
    opts?: { includeHidden?: boolean },
  ): Promise<WebhookListRow[]> {
    const includeHidden = opts?.includeHidden === true;
    const list = includeHidden
      ? await this.webhookRepo.find({ where: { userId }, order: { createdAt: 'DESC' } })
      : await this.webhookRepo.find({
          where: { userId, hiddenFromWebhooksList: false },
          order: { createdAt: 'DESC' },
        });
    return await Promise.all(list.map((w) => this.toListRow(userId, w)));
  }

  /**
   * Returns webhooks linked to a service (including hidden ones).
   * Used by auto-deploy to find the remote trigger URL.
   */
  async findWebhooksForService(
    serviceId: number,
    userId: number,
  ): Promise<WebhookListRow[]> {
    const rows = await this.webhookRepo.find({
      where: { serviceId, userId },
      order: { createdAt: 'DESC' },
    });
    return await Promise.all(rows.map((w) => this.toListRow(userId, w)));
  }

  async findOne(userId: number, id: number): Promise<WebhookDetailRow> {
    const w = await this.webhookRepo.findOne({ where: { id, userId } });
    if (!w) throw new NotFoundException('Webhook not found');
    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, w);
    return this.toDetailRow(w, remoteTriggerUrl);
  }

  async update(
    userId: number,
    id: number,
    dto: UpdateWebhookDto,
  ): Promise<WebhookDetailRow> {
    const w = await this.webhookRepo.findOne({ where: { id, userId } });
    if (!w) throw new NotFoundException('Webhook not found');

    const beforeRemote = w.remoteServerId;
    const beforeDocker = w.dockerCommand;
    const beforeNotifyOnTrigger = w.notifyOnTrigger;
    const beforeNotifyChannelId = w.notifyChannelId;
    const beforeNotifyMessage = w.notifyMessage;
    const beforeHooksPublicHost = w.hooksPublicHost;

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
    if (dto.dockerCommand !== undefined) {
      if (w.serviceAction === 'docker_command') {
        w.dockerCommand = dto.dockerCommand?.trim() || null;
      }
    }
    if (dto.remoteServerId !== undefined) {
      if (w.serviceAction === 'docker_command') {
        const nextId = dto.remoteServerId ?? null;
        if (nextId == null || nextId < 1) {
          throw new BadRequestException(
            'A deploy remote server is required for bash webhooks.',
          );
        }
        await this.remoteServersService.assertDeployServerById(nextId, userId);
        w.remoteServerId = nextId;
      } else {
        w.remoteServerId = null;
      }
    }
    if (dto.hooksPublicHost !== undefined && w.serviceAction === 'docker_command') {
      const next =
        dto.hooksPublicHost === null || dto.hooksPublicHost === ''
          ? null
          : this.resolveHooksPublicHostForStorage(dto.hooksPublicHost);
      if (next) {
        this.assertPlausibleHooksPublicHost(next);
      }
      w.hooksPublicHost = next;
    }
    if (
      dto.remoteTriggerUrlScheme !== undefined &&
      w.serviceAction === 'docker_command'
    ) {
      w.remoteTriggerUrlScheme = this.normalizeRemoteTriggerUrlScheme(
        dto.remoteTriggerUrlScheme,
      );
    }
    if (dto.hooksTriggerOrigin !== undefined && w.serviceAction === 'docker_command') {
      if (dto.hooksTriggerOrigin === null || dto.hooksTriggerOrigin === '') {
        w.hooksTriggerOrigin = null;
      } else {
        w.hooksTriggerOrigin = this.normalizeHooksTriggerOriginInput(
          dto.hooksTriggerOrigin,
        );
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

    const hadRemoteFile =
      beforeRemote != null &&
      !!(beforeDocker?.trim()) &&
      w.serviceAction === 'docker_command';
    if (
      hadRemoteFile &&
      (saved.remoteServerId !== beforeRemote ||
        !saved.dockerCommand?.trim() ||
        saved.serviceAction !== 'docker_command')
    ) {
      await this.remoteServersService
        .removeRemoteWebhookScript(beforeRemote, userId, saved.secretToken)
        .catch(() => undefined);
      await this.syncWebhookAgentForRemoteServer(beforeRemote, userId);
    }

    const scriptOrTargetChanged =
      saved.remoteServerId !== beforeRemote ||
      (beforeDocker?.trim() ?? '') !== (saved.dockerCommand?.trim() ?? '');
    const notifySettingsChanged =
      saved.notifyOnTrigger !== beforeNotifyOnTrigger ||
      saved.notifyChannelId !== beforeNotifyChannelId ||
      (saved.notifyMessage?.trim() ?? '') !==
        (beforeNotifyMessage?.trim() ?? '');
    const hooksPublicHostChanged =
      (saved.hooksPublicHost?.trim() ?? '') !==
        (beforeHooksPublicHost?.trim() ?? '');
    const needsScriptRewrite =
      saved.serviceAction === 'docker_command' &&
      saved.remoteServerId != null &&
      !!saved.dockerCommand?.trim() &&
      (scriptOrTargetChanged || notifySettingsChanged);
    const needsAgentSync =
      saved.serviceAction === 'docker_command' &&
      saved.remoteServerId != null &&
      !!saved.dockerCommand?.trim() &&
      (scriptOrTargetChanged || notifySettingsChanged || hooksPublicHostChanged);

    if (needsAgentSync) {
      await this.syncWebhookAgentForRemoteServer(saved.remoteServerId, userId);
    }

    if (needsScriptRewrite && saved.remoteServerId != null) {
      let body = saved.dockerCommand!.trim();
      if (
        saved.serviceId != null &&
        looksLikeGeneratedOnHostRedeployScript(body)
      ) {
        try {
          const svc = await this.servicesService.findOne(saved.serviceId);
          body = buildOnHostRedeployScriptBody(svc);
          saved.dockerCommand = body;
          await this.webhookRepo.save(saved);
        } catch {
          /* keep saved body */
        }
      }
      const notificationEnvLines = await this.mergeRemoteWebhookNotificationAndBundleEnv(
        userId,
        saved.notifyOnTrigger,
        saved.notifyChannelId,
        saved.notifyMessage,
        saved.serviceId,
      );
      await this.remoteServersService.writeRemoteWebhookScript(
        saved.remoteServerId,
        userId,
        saved.secretToken,
        body,
        notificationEnvLines,
      );
    }

    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, saved);
    return this.toDetailRow(saved, remoteTriggerUrl);
  }

  async remove(userId: number, id: number): Promise<void> {
    const w = await this.webhookRepo.findOne({ where: { id, userId } });
    if (!w) throw new NotFoundException('Webhook not found');
    const remoteId = w.remoteServerId;
    if (
      w.serviceAction === 'docker_command' &&
      w.remoteServerId != null &&
      w.dockerCommand?.trim()
    ) {
      await this.remoteServersService
        .removeRemoteWebhookScript(w.remoteServerId, userId, w.secretToken)
        .catch(() => undefined);
    }
    const res = await this.webhookRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Webhook not found');
    await this.syncWebhookAgentForRemoteServer(remoteId, userId);
  }

  /**
   * Deletes all webhooks tied to a service (DB rows, remote agent scripts, Swarm sync).
   * Called when a service is removed so tokens and scripts do not linger.
   */
  async removeAllForService(userId: number, serviceId: number): Promise<void> {
    const rows = await this.webhookRepo.find({ where: { serviceId, userId } });
    for (const w of rows) {
      await this.remove(userId, w.id);
    }
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
          const svcRow = await this.servicesService.findOne(w.serviceId);
          const useAutoDeploy =
            svcRow?.autoDeployEnabled &&
            svcRow.autoDeployGitProvider &&
            svcRow.autoDeployRepoId;
          if (useAutoDeploy) {
            action = 'auto_deploy';
            const r = await this.servicesService.runAutoDeployCloneAndDeploy(
              w.serviceId,
            );
            success = r.success;
            output = r.output;
          } else {
            action = 'redeploy';
            const r = await this.servicesService.executeDeployment(
              w.serviceId,
              'redeploy',
              { actingUserId: w.userId },
            );
            success = Boolean(r.success);
            output = String(r.output ?? '');
          }
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
                1,
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
                1,
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
                1,
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
          w.dockerCommand
        ) {
          const useExecutorRedeploy =
            this.shouldRunExecutorRedeployForDockerWebhook(w);
          if (useExecutorRedeploy) {
            const svcRowCmd = w.serviceId
              ? await this.servicesService.findOne(w.serviceId)
              : null;
            const useAutoDeployCmd =
              svcRowCmd?.autoDeployEnabled &&
              svcRowCmd.autoDeployGitProvider &&
              svcRowCmd.autoDeployRepoId;
            if (useAutoDeployCmd) {
              action = 'auto_deploy';
              const r =
                await this.servicesService.runAutoDeployCloneAndDeploy(
                  w.serviceId!,
                );
              success = r.success;
              output = r.output;
            } else {
              action = 'redeploy';
              const r = await this.servicesService.executeDeployment(
                w.serviceId!,
                'redeploy',
                { actingUserId: 1 },
              );
              success = Boolean(r.success);
              output = String(r.output ?? '');
            }
          } else {
            const scriptToRun =
              w.remoteServerId != null
                ? `bash '${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${w.secretToken}.sh'`
                : w.dockerCommand;
            const r = await this.executorService.runSystemScript(
              scriptToRun,
              w.remoteServerId,
              1,
            );
            success = r.success;
            output = r.output;
          }
        } else {
          success = false;
          output = 'Webhook is misconfigured (missing action details).';
        }
      }
    } catch (e) {
      success = false;
      output = e instanceof Error ? e.message : String(e);
    }

    const actionLabel = action === 'docker_command' ? 'bash_script' : action;

    const payload = {
      ok: success,
      webhook: w.name,
      action: actionLabel,
      output: output.slice(0, 32000),
    };

    const ranRemoteBashOnly =
      w.serviceAction === 'docker_command' &&
      w.remoteServerId != null &&
      w.dockerCommand != null &&
      !this.shouldRunExecutorRedeployForDockerWebhook(w);
    const notificationSentOnRemote = ranRemoteBashOnly;
    if (
      w.notifyOnTrigger &&
      w.notifyChannelId &&
      w.notifyMessage &&
      !notificationSentOnRemote
    ) {
      try {
        await this.notificationsService.sendMessage(
          1,
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
