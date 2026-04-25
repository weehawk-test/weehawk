import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import * as net from 'net';
import { Like, Repository } from 'typeorm';
import { NotificationService } from '../notifications/notification.service';
import { ExecutorService } from '../executor/executor.service';
import { ServicesService } from '../services/services.service';
import { getErrorMessage } from '../utils/error-message';
import {
  RemoteServersService,
  WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR,
} from '../remote-servers/remote-servers.service';
import {
  isRemoteSshIpBlocked,
  REMOTE_SSH_HOST_POLICY_HINT,
} from '../remote-servers/remote-ssh-host-policy';
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
import { generatePublicId } from '../common/public-id';

export type WebhookListRow = {
  id: number;
  publicId: string;
  name: string;
  description: string;
  serviceId: number | null;
  remoteServerId: number | null;
  notifyOnTrigger: boolean;
  createdAt: string;
  summary: string;
  secretToken: string;
  remoteTriggerUrl: string | null;
  /** Traefik hostname for the Swarm webhook agent when configured. */
  hooksPublicHost: string | null;
  /** Always https prefix for the remote trigger URL. */
  remoteTriggerUrlScheme: WebhookRemoteTriggerUrlScheme;
};

export type WebhookDetailRow = WebhookListRow & {
  bashScript: string | null;
  notifyChannelId: number | null;
  notifyMessage: string | null;
  secretToken: string;
  /** When script runs on a remote server: URL for the on-host agent at that server’s public host. */
  remoteTriggerUrl: string | null;
};

@Injectable()
export class WebhooksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationService,
    private readonly remoteServersService: RemoteServersService,
    private readonly configService: ConfigService,
  ) {}

  private runRemoteSyncInBackground(taskLabel: string, run: () => Promise<void>): void {
    setTimeout(() => {
      void run().catch((error: unknown) => {
        this.logger.warn(
          `Background webhook sync failed (${taskLabel}): ${getErrorMessage(error)}`,
        );
      });
    }, 0);
  }

  private async ensurePublicId(w: Webhook): Promise<Webhook> {
    if (w.publicId) return w;
    w.publicId = generatePublicId('whk');
    return this.webhookRepo.save(w);
  }

  private async resolveEntity(userId: number, idOrPublicId: string | number): Promise<Webhook> {
    const raw = String(idOrPublicId).trim();
    const row = await this.webhookRepo.findOne({
      where: { publicId: raw, userId },
    });
    if (!row) throw new NotFoundException('Webhook not found');
    return this.ensurePublicId(row);
  }

  private allowPrivateHooksPublicHosts(): boolean {
    const raw =
      this.configService.get<string>('WEEHAWK_ALLOW_PRIVATE_REMOTE_SSH_HOSTS') ?? '';
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
  }

  /** One-time style backfill: older auto redeploy rows had no flag; align them with new creates. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const legacy = await this.webhookRepo.find({
        where: {
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
    notifyChannelId: number | null | undefined,
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
   * If the service has a linked Git repo, resolve clone credentials so the
   * remote redeploy script can `git clone` / fetch without the API.
   * (Independent of {@link Service.autoDeployEnabled}, which only gates provider push webhooks.)
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
      // Redeploy webhooks need clone credentials whenever a Git repo is linked, even if push-trigger
      // auto-deploy is disabled — otherwise on-host Dockerfile/Nixpacks runs never pull fresh source.
      if (!svc.autoDeployGitProvider || !svc.autoDeployRepoId) {
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
            const authUrl = await this.servicesService.resolveGitlabAuthenticatedUrl(
              repoId,
              svc.project.userId,
            );
            return { cloneUrl: authUrl, branch };
          } catch {
            return { cloneUrl: repoId, branch };
          }
        }
        try {
          const url = await this.servicesService.resolveGitlabProjectCloneUrl(
            projectId,
            svc.project.userId,
          );
          if (url) {
            const glApi =
              await this.servicesService.getGitlabArchiveApiCredentials(
                svc.project.userId,
              );
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
    if (!dto.bashScript?.trim()) {
      throw new BadRequestException('bashScript is required.');
    }
    if (dto.remoteServerId == null || dto.remoteServerId < 1) {
      throw new BadRequestException(
        'A deploy remote server is required for bash webhooks.',
      );
    }
    const host = this.resolveHooksPublicHostForStorage(dto.hooksPublicHost);
    if (!host?.trim()) {
      throw new BadRequestException('hooksPublicHost is required.');
    }
    this.assertPlausibleHooksPublicHost(host);
    const hasNotifyChannel =
      dto.notifyChannelId != null && dto.notifyChannelId >= 1;
    const hasNotifyMessage = Boolean(dto.notifyMessage?.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      throw new BadRequestException(
        'Provide both notifyChannelId and notifyMessage, or leave both empty.',
      );
    }
  }

  /** Resolves optional user domain/host for Traefik routing (no forced webhook subdomain). */
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
    void raw;
    return 'https';
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
        'hooksPublicHost must be a hostname only (no scheme, port, or path). Example: example.com',
      );
    }
    if (
      !/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(
        t,
      )
    ) {
      throw new BadRequestException('hooksPublicHost does not look like a valid hostname.');
    }
    if (!this.allowPrivateHooksPublicHosts()) {
      const v = net.isIP(t);
      if ((v === 4 || v === 6) && isRemoteSshIpBlocked(t)) {
        throw new BadRequestException(
          `hooksPublicHost must use a publicly reachable address. ${REMOTE_SSH_HOST_POLICY_HINT}`,
        );
      }
    }
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

  /** Env file beside the remote `.sh`, same pattern as cron jobs (`send_notification` + EXIT trap). */
  private async buildRemoteWebhookNotificationEnvLines(
    userId: number,
    notifyOnTrigger: boolean,
    notifyChannelId: number | null | undefined,
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
      where: { remoteServerId },
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

  private summaryLabel(): string {
    return 'On-host bash';
  }

  private baseListFields(w: Webhook): Omit<WebhookListRow, 'remoteTriggerUrl'> {
    return {
      id: w.id,
      publicId: w.publicId,
      name: w.name,
      description: w.description ?? '',
      serviceId: w.serviceId,
      remoteServerId: w.remoteServerId,
      notifyOnTrigger: w.notifyOnTrigger,
      createdAt: w.createdAt.toISOString(),
      summary: this.summaryLabel(),
      secretToken: w.secretToken,
      hooksPublicHost: w.hooksPublicHost ?? null,
      remoteTriggerUrlScheme: this.normalizeRemoteTriggerUrlScheme(w.remoteTriggerUrlScheme),
    };
  }

  private async toListRow(userId: number, w: Webhook): Promise<WebhookListRow> {
    const row = await this.ensurePublicId(w);
    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, row);
    return {
      ...this.baseListFields(row),
      remoteTriggerUrl,
    };
  }

  private async toDetailRow(
    w: Webhook,
    remoteTriggerUrl: string | null = null,
  ): Promise<WebhookDetailRow> {
    const row = await this.ensurePublicId(w);
    return {
      ...this.baseListFields(row),
      remoteTriggerUrl,
      bashScript: row.bashScript,
      notifyChannelId: row.notifyChannelId,
      notifyMessage: row.notifyMessage,
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
    if (looksLikeGeneratedOnHostRedeployScript(w.bashScript)) {
      return true;
    }
    return typeof w.name === 'string' && w.name.startsWith('Redeploy ·');
  }

  private async resolveRemoteTriggerUrl(
    userId: number,
    w: Webhook,
  ): Promise<string | null> {
    if (w.remoteServerId == null || !w.bashScript?.trim()) {
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

  async create(
    userId: number,
    dto: CreateWebhookDto,
  ): Promise<WebhookDetailRow> {
    this.validateCreate(dto);
    if (dto.remoteServerId != null) {
      await this.remoteServersService.assertDeployServerById(
        dto.remoteServerId,
        userId,
      );
    }
    if (dto.notifyChannelId != null && dto.notifyChannelId >= 1) {
      await this.assertNotificationChannel(userId, dto.notifyChannelId);
    }
    const serviceIdOrPublicId = dto.serviceId?.trim();
    let resolvedServiceId: number | null = null;
    if (serviceIdOrPublicId) {
      try {
        resolvedServiceId = await this.servicesService.resolveServiceIdForUser(
          serviceIdOrPublicId,
          userId,
        );
      } catch {
        throw new BadRequestException('Service not found.');
      }
    }

    const secretToken = randomBytes(32).toString('hex');
    const notifyOnTriggerCreate =
      dto.notifyChannelId != null &&
      dto.notifyChannelId >= 1 &&
      Boolean(dto.notifyMessage?.trim());
    const hooksPublicStored = this.resolveHooksPublicHostForStorage(
      dto.hooksPublicHost,
    );
    let resolvedBashScript = dto.bashScript?.trim() ?? '';
    if (
      resolvedServiceId != null &&
      resolvedBashScript &&
      looksLikeGeneratedOnHostRedeployScript(resolvedBashScript)
    ) {
      try {
        const svc = await this.servicesService.findOne(resolvedServiceId);
        resolvedBashScript = buildOnHostRedeployScriptBody(svc);
      } catch {
        /* keep client body */
      }
    }

    const w = this.webhookRepo.create({
      publicId: generatePublicId('whk'),
      userId,
      secretToken,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      serviceId: resolvedServiceId,
      remoteServerId:
        dto.remoteServerId != null ? dto.remoteServerId : null,
      bashScript: resolvedBashScript ? resolvedBashScript : null,
      notifyOnTrigger: notifyOnTriggerCreate,
      notifyChannelId: dto.notifyChannelId ?? null,
      notifyMessage: dto.notifyMessage?.trim() || null,
      hooksPublicHost: hooksPublicStored,
      remoteTriggerUrlScheme: 'https',
      hiddenFromWebhooksList: dto.hiddenFromWebhooksList === true,
    });
    const saved = await this.webhookRepo.save(w);
    if (dto.remoteServerId != null && resolvedBashScript) {
      this.runRemoteSyncInBackground(`create webhook ${saved.id}`, async () => {
        const mergedHosts = await this.mergeHooksPublicHostsForRemoteCreate(
          dto.remoteServerId!,
          hooksPublicStored,
        );
        await this.remoteServersService.ensureRemoteWebhookListening(
          dto.remoteServerId!,
          userId,
          mergedHosts,
        );
        const notificationEnvLines = await this.mergeRemoteWebhookNotificationAndBundleEnv(
          userId,
          notifyOnTriggerCreate,
          dto.notifyChannelId,
          dto.notifyMessage,
          resolvedServiceId,
        );
        await this.remoteServersService.writeRemoteWebhookScript(
          dto.remoteServerId!,
          userId,
          secretToken,
          resolvedBashScript,
          notificationEnvLines,
        );
      });
    }
    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, saved);
    return await this.toDetailRow(saved, remoteTriggerUrl);
  }

  /**
   * After a remote deploy (or mirror sync), re-upload on-host redeploy `.sh` files so paths match
   * the current `appName` / compose type. Only touches webhooks that still look like the generated template.
   */
  async refreshGeneratedOnHostRedeployScriptsForService(serviceId: number): Promise<void> {
    const service = await this.servicesService.findOne(serviceId);
    const canonical = buildOnHostRedeployScriptBody(service);
    const rows = await this.webhookRepo.find({
      where: { serviceId },
    });
    const userId = service.project?.userId ?? 0;
    for (const w of rows) {
      if (w.remoteServerId == null) continue;
      if (!looksLikeGeneratedOnHostRedeployScript(w.bashScript)) continue;
      w.bashScript = canonical;
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

  async findOne(userId: number, idOrPublicId: string | number): Promise<WebhookDetailRow> {
    const w = await this.resolveEntity(userId, idOrPublicId);
    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, w);
    return await this.toDetailRow(w, remoteTriggerUrl);
  }

  async readLastRunLog(
    userId: number,
    idOrPublicId: string | number,
    opts?: { lines?: number },
  ): Promise<{ log: string; source: string }> {
    const w = await this.resolveEntity(userId, idOrPublicId);
    if (!w.bashScript?.trim() || w.remoteServerId == null) {
      return { log: '', source: 'not-applicable' };
    }
    if (this.shouldRunExecutorRedeployForDockerWebhook(w)) {
      return { log: '', source: 'executor-redeploy' };
    }
    const log = await this.remoteServersService.readRemoteWebhookScriptLog(
      w.remoteServerId,
      userId,
      w.secretToken,
      { lines: opts?.lines ?? 200 },
    );
    return { log, source: 'remote-script-log' };
  }

  async update(
    userId: number,
    idOrPublicId: string | number,
    dto: UpdateWebhookDto,
  ): Promise<WebhookDetailRow> {
    const w = await this.resolveEntity(userId, idOrPublicId);

    const beforeRemote = w.remoteServerId;
    const beforeBash = w.bashScript;
    const beforeNotifyOnTrigger = w.notifyOnTrigger;
    const beforeNotifyChannelId = w.notifyChannelId;
    const beforeNotifyMessage = w.notifyMessage;
    const beforeHooksPublicHost = w.hooksPublicHost;

    if (dto.name !== undefined) w.name = dto.name.trim();
    if (dto.description !== undefined) {
      w.description = dto.description.trim() || null;
    }
    if (dto.notifyChannelId !== undefined) {
      w.notifyChannelId = dto.notifyChannelId;
    }
    if (dto.notifyMessage !== undefined) {
      w.notifyMessage = dto.notifyMessage?.trim() || null;
    }
    if (dto.bashScript !== undefined) {
      w.bashScript = dto.bashScript?.trim() || null;
    }
    if (dto.remoteServerId !== undefined) {
      const nextId = dto.remoteServerId ?? null;
      if (nextId == null || nextId < 1) {
        throw new BadRequestException(
          'A deploy remote server is required for bash webhooks.',
        );
      }
      await this.remoteServersService.assertDeployServerById(nextId, userId);
      w.remoteServerId = nextId;
    }
    if (dto.hooksPublicHost !== undefined) {
      const next =
        dto.hooksPublicHost === null || dto.hooksPublicHost === ''
          ? null
          : this.resolveHooksPublicHostForStorage(dto.hooksPublicHost);
      if (next) {
        this.assertPlausibleHooksPublicHost(next);
      }
      w.hooksPublicHost = next;
    }
    w.remoteTriggerUrlScheme = 'https';
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

    const hadRemoteFile = beforeRemote != null && !!(beforeBash?.trim());
    const shouldRemoveOldRemoteFile =
      hadRemoteFile &&
      (saved.remoteServerId !== beforeRemote || !saved.bashScript?.trim());

    const scriptOrTargetChanged =
      saved.remoteServerId !== beforeRemote ||
      (beforeBash?.trim() ?? '') !== (saved.bashScript?.trim() ?? '');
    const notifySettingsChanged =
      saved.notifyOnTrigger !== beforeNotifyOnTrigger ||
      saved.notifyChannelId !== beforeNotifyChannelId ||
      (saved.notifyMessage?.trim() ?? '') !==
        (beforeNotifyMessage?.trim() ?? '');
    const hooksPublicHostChanged =
      (saved.hooksPublicHost?.trim() ?? '') !==
        (beforeHooksPublicHost?.trim() ?? '');
    const needsScriptRewrite =
      saved.remoteServerId != null &&
      !!saved.bashScript?.trim() &&
      (scriptOrTargetChanged || notifySettingsChanged);
    const needsAgentSync =
      saved.remoteServerId != null &&
      !!saved.bashScript?.trim() &&
      (scriptOrTargetChanged || notifySettingsChanged || hooksPublicHostChanged);

    if (shouldRemoveOldRemoteFile || needsAgentSync || needsScriptRewrite) {
      this.runRemoteSyncInBackground(`update webhook ${saved.id}`, async () => {
        if (shouldRemoveOldRemoteFile && beforeRemote != null) {
          await this.remoteServersService
            .removeRemoteWebhookScript(beforeRemote, userId, saved.secretToken)
            .catch(() => undefined);
          await this.syncWebhookAgentForRemoteServer(beforeRemote, userId);
        }

        if (needsAgentSync && saved.remoteServerId != null) {
          await this.syncWebhookAgentForRemoteServer(saved.remoteServerId, userId);
        }

        if (needsScriptRewrite && saved.remoteServerId != null) {
          let body = saved.bashScript!.trim();
          if (
            saved.serviceId != null &&
            looksLikeGeneratedOnHostRedeployScript(body)
          ) {
            try {
              const svc = await this.servicesService.findOne(saved.serviceId);
              body = buildOnHostRedeployScriptBody(svc);
              saved.bashScript = body;
              await this.webhookRepo.save(saved);
            } catch {
              /* keep saved body */
            }
          }
          const notificationEnvLines =
            await this.mergeRemoteWebhookNotificationAndBundleEnv(
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
      });
    }

    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, saved);
    return await this.toDetailRow(saved, remoteTriggerUrl);
  }

  async remove(userId: number, idOrPublicId: string | number): Promise<void> {
    const w = await this.resolveEntity(userId, idOrPublicId);
    const remoteId = w.remoteServerId;
    if (w.remoteServerId != null && w.bashScript?.trim()) {
      await this.remoteServersService
        .removeRemoteWebhookScript(w.remoteServerId, userId, w.secretToken)
        .catch(() => undefined);
    }
    const res = await this.webhookRepo.delete({ id: w.id, userId });
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
      const ensured = await this.ensurePublicId(w);
      await this.remove(userId, ensured.publicId);
    }
  }

  async triggerByToken(token: string): Promise<Record<string, unknown>> {
    const w = await this.webhookRepo.findOne({
      where: { secretToken: token },
    });
    if (!w) {
      throw new NotFoundException('Unknown webhook');
    }
    let action = 'none';
    let success = true;
    let output = '';

    try {
      if (w.bashScript) {
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
            const r = await this.servicesService.runAutoDeployCloneAndDeploy(
              w.serviceId!,
            );
            success = r.success;
            output = r.output;
          } else {
            action = 'redeploy';
            const r = await this.servicesService.executeDeployment(
              w.serviceId!,
              'redeploy',
              { actingUserId: w.userId },
            );
            success = Boolean(r.success);
            output = String(r.output ?? '');
          }
        } else {
          action = 'bash_script';
          const scriptToRun =
            w.remoteServerId != null
              ? `bash '${WEEHAWK_REMOTE_WEBHOOK_SCRIPTS_DIR}/${w.secretToken}.sh'`
              : w.bashScript;
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
        output = 'Webhook is misconfigured (missing bash script).';
      }
    } catch (e) {
      success = false;
      output = e instanceof Error ? e.message : String(e);
    }

    const actionLabel = action;

    const payload = {
      ok: success,
      webhook: w.name,
      action: actionLabel,
      output: output.slice(0, 32000),
    };

    const ranRemoteBashOnly =
      w.remoteServerId != null &&
      w.bashScript != null &&
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
