import {
  BadRequestException,
  forwardRef,
  HttpException,
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
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import {
  assertOrganizationWorkspaceAccessForInternalId,
  resolveRequiredOrganizationInternalIdForMember,
} from '../common/organization-workspace-scope';
import {
  ORGANIZATION_WORKSPACE_PERMISSIONS,
  type OrganizationWorkspacePermission,
} from '../organizations/organization-workspace-permissions';
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
import {
  Webhook,
  type WebhookRemoteTriggerUrlScheme,
} from './entities/webhook.entity';
import { deriveHooksPublicHost } from './hooks-public-host';
import {
  buildOnHostRedeployScriptBody,
  looksLikeGeneratedOnHostRedeployScript,
  onHostWebhookBundleEnvLines,
} from '../common/on-host-redeploy-script';
import { generatePublicId } from '../common/public-id';
import { RemoteServerTenantScopedRepository } from '../common/tenant-scoped.service';
import { OrgRealtimeEmitter } from '../org-realtime/org-realtime-emitter.service';

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
  /** When script runs on a remote server: URL for the on-host agent at that server’s public host. */
  remoteTriggerUrl: string | null;
};

@Injectable()
export class WebhooksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly scopedWebhooks: RemoteServerTenantScopedRepository<Webhook>;

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepo: Repository<OrganizationMembership>,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly organizationsService: OrganizationsService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    private readonly executorService: ExecutorService,
    private readonly notificationsService: NotificationService,
    private readonly remoteServersService: RemoteServersService,
    private readonly configService: ConfigService,
    private readonly orgRealtime: OrgRealtimeEmitter,
  ) {
    this.scopedWebhooks = new RemoteServerTenantScopedRepository<Webhook>(
      this.webhookRepo,
      this.membershipRepo,
      'Webhook',
    );
  }

  private logSecurityAudit(
    organizationId: number,
    userId: number,
    action: string,
    endpoint: string,
    extra: Record<string, unknown>,
  ): void {
    void this.organizationsService
      .appendOrganizationAuditEvent(organizationId, userId, action, {
        metadata: { endpoint, ...extra },
      })
      .catch(() => undefined);
  }

  /** Log denied / missing resource (HTTP 403/404) for org-scoped webhook mutations. */
  private logWebhookSecurityHttpDenial(
    expectedOrg: number,
    userId: number,
    action: string,
    endpoint: string,
    err: unknown,
  ): void {
    if (!(err instanceof HttpException)) return;
    const httpStatus = err.getStatus();
    if (httpStatus !== 404 && httpStatus !== 403) return;
    this.logSecurityAudit(expectedOrg, userId, action, endpoint, { httpStatus });
  }

  private async requireWorkspaceOrgId(
    userId: number,
    organizationPublicId: string | null | undefined,
    extra?: OrganizationWorkspacePermission[],
  ): Promise<number> {
    return resolveRequiredOrganizationInternalIdForMember(
      this.organizationsRepository,
      userId,
      organizationPublicId,
      {
        requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS,
        ...(extra != null && extra.length > 0
          ? { requireAllWorkspaceAreas: extra }
          : {}),
      },
    );
  }

  private assertWebhookWorkspace(w: Webhook, expectedOrgId: number): void {
    const rowOrg = w.organizationId ?? null;
    if (rowOrg !== expectedOrgId) {
      throw new NotFoundException('Webhook not found');
    }
  }

  private async deleteWebhookArtifacts(userId: number, w: Webhook): Promise<void> {
    const remoteId = w.remoteServerId;
    if (w.remoteServerId != null && w.bashScript?.trim()) {
      await this.remoteServersService
        .removeRemoteWebhookScript(w.remoteServerId, userId, w.secretToken)
        .catch(() => undefined);
    }
    await this.scopedWebhooks.deleteScoped(w.id, userId);
    await this.syncWebhookAgentForRemoteServer(remoteId, userId);
  }

  private runRemoteSyncInBackground(
    taskLabel: string,
    run: () => Promise<void>,
  ): void {
    setTimeout(() => {
      void run().catch((error: unknown) => {
        this.logger.warn(
          `Background webhook sync failed (${taskLabel}): ${getErrorMessage(error)}`,
        );
      });
    }, 0);
  }

  // SYSTEM-LEVEL BYPASS: Required for [bootstrap migration across tenants].
  private async _internal_system_saveWebhook(row: Webhook): Promise<Webhook> {
    return this.webhookRepo.save(row);
  }

  // SYSTEM-LEVEL BYPASS: Required for [public token trigger without signed user context].
  private async _internal_system_findBySecretToken(
    token: string,
  ): Promise<Webhook | null> {
    return this._internal_system_findOneWebhook({ where: { secretToken: token } });
  }

  // SYSTEM-LEVEL BYPASS: Required for internal/non-request webhook repository reads.
  private async _internal_system_findOneWebhook(
    options: Parameters<Repository<Webhook>['findOne']>[0],
  ): Promise<Webhook | null> {
    return this.webhookRepo.findOne(options);
  }

  // SYSTEM-LEVEL BYPASS: Required for internal/non-request webhook repository reads.
  private async _internal_system_findWebhooks(
    options: Parameters<Repository<Webhook>['find']>[0],
  ): Promise<Webhook[]> {
    return this.webhookRepo.find(options);
  }

  private async ensurePublicId(w: Webhook): Promise<Webhook> {
    if (w.publicId) return w;
    w.publicId = generatePublicId('whk');
    return this.scopedWebhooks.saveScoped(w, w.userId);
  }

  private async resolveEntity(
    userId: number,
    idOrPublicId: string | number,
  ): Promise<Webhook> {
    const raw = String(idOrPublicId).trim();
    if (/^\d+$/.test(raw)) {
      const row = await this.scopedWebhooks.findScoped(Number(raw), userId);
      return this.ensurePublicId(row);
    }
    const row = await this.scopedWebhooks.findScopedBy('publicId', raw, userId);
    return this.ensurePublicId(row);
  }

  private allowPrivateHooksPublicHosts(): boolean {
    const raw =
      this.configService.get<string>(
        'WEEHAWK_ALLOW_PRIVATE_REMOTE_SSH_HOSTS',
      ) ?? '';
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
  }

  /** One-time style backfill: older auto redeploy rows had no flag; align them with new creates. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const legacy = await this._internal_system_findWebhooks({
        where: {
          name: Like('Redeploy ·%'),
          hiddenFromWebhooksList: false,
        },
      });
      for (const w of legacy) {
        w.hiddenFromWebhooksList = true;
      }
      if (legacy.length > 0) {
        for (const w of legacy) {
          await this._internal_system_saveWebhook(w);
        }
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
      const svc = await this.servicesService.findOne(serviceId, userId);
      const autoDeploy = await this.resolveAutoDeployCloneInfo(serviceId, userId);
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
    userId: number,
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
      const svc = await this.servicesService.getScopedServiceForUser(
        serviceId,
        userId,
      );
      // Redeploy webhooks need clone credentials whenever a Git repo is linked, even if push-trigger
      // auto-deploy is disabled — otherwise on-host Dockerfile/Nixpacks runs never pull fresh source.
      if (!svc.autoDeployGitProvider || !svc.autoDeployRepoId) {
        return null;
      }
      const ownerId = svc.project?.userId;
      if (!ownerId || ownerId < 1) {
        return null;
      }
      const orgInternal = svc.project?.organizationId;
      if (!orgInternal || orgInternal < 1) {
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
        const ghCreds =
          await this.servicesService.getGithubAppCredentials(orgInternal);
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
            const authUrl =
              await this.servicesService.resolveGitlabAuthenticatedUrl(
                repoId,
                orgInternal,
              );
            return { cloneUrl: authUrl, branch };
          } catch {
            return { cloneUrl: repoId, branch };
          }
        }
        try {
          const url = await this.servicesService.resolveGitlabProjectCloneUrl(
            projectId,
            orgInternal,
          );
          if (url) {
            const glApi =
              await this.servicesService.getGitlabArchiveApiCredentials(
                orgInternal,
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
        } catch {
          /* fall through */
        }
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
      throw new BadRequestException(
        'hooksPublicHost does not look like a valid hostname.',
      );
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
    const rows = await this._internal_system_findWebhooks({
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
    const fromDb =
      await this.collectHooksPublicHostsForRemoteServer(remoteServerId);
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
    const hosts =
      await this.collectHooksPublicHostsForRemoteServer(remoteServerId);
    await this.remoteServersService.ensureRemoteWebhookListening(
      remoteServerId,
      userId,
      hosts,
    );
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
      hooksPublicHost: w.hooksPublicHost ?? null,
      remoteTriggerUrlScheme: this.normalizeRemoteTriggerUrlScheme(
        w.remoteTriggerUrlScheme,
      ),
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
    const scheme = this.normalizeRemoteTriggerUrlScheme(
      w.remoteTriggerUrlScheme,
    );
    const publicHost = w.hooksPublicHost?.trim();
    if (publicHost) {
      return this.remoteServersService.formatRemoteWebhookTriggerUrlFromPublicHost(
        publicHost,
        w.secretToken,
        scheme,
      );
    }
    try {
      const rs = await this.remoteServersService.findOne(
        w.remoteServerId,
        userId,
      );
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
    const orgId = await this.requireWorkspaceOrgId(
      userId,
      dto.organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_ADD],
    );
    if (dto.remoteServerId != null) {
      await this.remoteServersService.assertDeployServerById(
        dto.remoteServerId,
        userId,
      );
    }
    if (dto.notifyChannelId != null && dto.notifyChannelId >= 1) {
      await this.assertNotificationChannel(
        userId,
        dto.notifyChannelId,
        dto.organizationPublicId,
      );
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
    if (resolvedServiceId != null) {
      const svc = await this.servicesService.getScopedServiceForUser(
        resolvedServiceId,
        userId,
      );
      const pOrg = svc.project?.organizationId ?? null;
      if (pOrg !== orgId) {
        throw new BadRequestException(
          'Service does not belong to this workspace.',
        );
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
        const svc = await this.servicesService.findOne(resolvedServiceId, userId);
        resolvedBashScript = buildOnHostRedeployScriptBody(svc);
      } catch {
        /* keep client body */
      }
    }

    const w = this.webhookRepo.create({
      publicId: generatePublicId('whk'),
      userId,
      organizationId: orgId,
      secretToken,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      serviceId: resolvedServiceId,
      remoteServerId: dto.remoteServerId != null ? dto.remoteServerId : null,
      bashScript: resolvedBashScript ? resolvedBashScript : null,
      notifyOnTrigger: notifyOnTriggerCreate,
      notifyChannelId: dto.notifyChannelId ?? null,
      notifyMessage: dto.notifyMessage?.trim() || null,
      hooksPublicHost: hooksPublicStored,
      remoteTriggerUrlScheme: 'https',
      hiddenFromWebhooksList: dto.hiddenFromWebhooksList === true,
    });
    const saved = await this.scopedWebhooks.saveScoped(w, userId);
    const ensured = await this.ensurePublicId(saved);
    this.logSecurityAudit(orgId, userId, 'security.webhook.created', 'POST /api/webhooks', {
      webhookPublicId: ensured.publicId,
      webhookName: ensured.name,
      httpStatus: 201,
    });
    this.orgRealtime.notifyOrgDataChanged(orgId, {
      entity: 'webhook',
      action: 'created',
      publicId: ensured.publicId,
      resourceId: saved.id,
    });
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
        const notificationEnvLines =
          await this.mergeRemoteWebhookNotificationAndBundleEnv(
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
  async refreshGeneratedOnHostRedeployScriptsForService(
    serviceId: number,
  ): Promise<void> {
    const service = await this.servicesService.internalFindOneById(serviceId);
    const canonical = buildOnHostRedeployScriptBody(service);
    const rows = await this._internal_system_findWebhooks({
      where: { serviceId },
    });
    const userId = service.project?.userId ?? 0;
    for (const w of rows) {
      if (w.remoteServerId == null) continue;
      if (!looksLikeGeneratedOnHostRedeployScript(w.bashScript)) continue;
      w.bashScript = canonical;
      await this.scopedWebhooks.saveScoped(w, userId);
      const notificationEnvLines =
        await this.mergeRemoteWebhookNotificationAndBundleEnv(
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
    opts?: { includeHidden?: boolean; organizationPublicId?: string | null },
  ): Promise<WebhookListRow[]> {
    const includeHidden = opts?.includeHidden === true;
    const orgId = await this.requireWorkspaceOrgId(
      userId,
      opts?.organizationPublicId,
    );
    const baseWhere = includeHidden
      ? {}
      : { hiddenFromWebhooksList: false };
    const list = await this.scopedWebhooks.listForOrganization(
      userId,
      orgId,
      {
        where: baseWhere,
        order: { createdAt: 'DESC' },
      },
    );
    return await Promise.all(list.map((w) => this.toListRow(userId, w)));
  }

  /**
   * Returns webhooks linked to a service (including hidden ones).
   * Used by auto-deploy to find the remote trigger URL.
   */
  async findWebhooksForService(
    serviceId: number,
    projectUserId: number,
    projectOrganizationId: number,
  ): Promise<WebhookListRow[]> {
    const rows = await this._internal_system_findWebhooks({
      where: { serviceId, organizationId: projectOrganizationId },
      order: { createdAt: 'DESC' },
    });
    return await Promise.all(rows.map((w) => this.toListRow(projectUserId, w)));
  }

  async findOne(
    userId: number,
    idOrPublicId: string | number,
    organizationPublicId?: string | null,
  ): Promise<WebhookDetailRow> {
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
    );
    const w = await this.resolveEntity(userId, idOrPublicId);
    this.assertWebhookWorkspace(w, expectedOrg);
    const remoteTriggerUrl = await this.resolveRemoteTriggerUrl(userId, w);
    return await this.toDetailRow(w, remoteTriggerUrl);
  }

  async readLastRunLog(
    userId: number,
    idOrPublicId: string | number,
    opts?: { lines?: number; organizationPublicId?: string | null },
  ): Promise<{ log: string; source: string }> {
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      opts?.organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_LOGS],
    );
    const w = await this.resolveEntity(userId, idOrPublicId);
    this.assertWebhookWorkspace(w, expectedOrg);
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
    organizationPublicId?: string | null,
  ): Promise<WebhookDetailRow> {
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_EDIT],
    );
    const endpoint = `PATCH /api/webhooks/${encodeURIComponent(String(idOrPublicId))}`;
    let w: Webhook;
    try {
      w = await this.resolveEntity(userId, idOrPublicId);
      this.assertWebhookWorkspace(w, expectedOrg);
    } catch (e) {
      this.logWebhookSecurityHttpDenial(
        expectedOrg,
        userId,
        'security.webhook.updated',
        endpoint,
        e,
      );
      throw e;
    }

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
      await this.assertNotificationChannel(
        userId,
        w.notifyChannelId,
        organizationPublicId,
      );
    } else if (!w.notifyChannelId && !w.notifyMessage) {
      w.notifyOnTrigger = false;
    } else {
      throw new BadRequestException(
        'Provide both notifyChannelId and notifyMessage, or clear both.',
      );
    }

    const saved = await this.scopedWebhooks.saveScoped(w, userId);

    const hadRemoteFile = beforeRemote != null && !!beforeBash?.trim();
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
      (scriptOrTargetChanged ||
        notifySettingsChanged ||
        hooksPublicHostChanged);

    if (shouldRemoveOldRemoteFile || needsAgentSync || needsScriptRewrite) {
      this.runRemoteSyncInBackground(`update webhook ${saved.id}`, async () => {
        if (shouldRemoveOldRemoteFile && beforeRemote != null) {
          await this.remoteServersService
            .removeRemoteWebhookScript(beforeRemote, userId, saved.secretToken)
            .catch(() => undefined);
          await this.syncWebhookAgentForRemoteServer(beforeRemote, userId);
        }

        if (needsAgentSync && saved.remoteServerId != null) {
          await this.syncWebhookAgentForRemoteServer(
            saved.remoteServerId,
            userId,
          );
        }

        if (needsScriptRewrite && saved.remoteServerId != null) {
          let body = saved.bashScript!.trim();
          if (
            saved.serviceId != null &&
            looksLikeGeneratedOnHostRedeployScript(body)
          ) {
            try {
              const svc = await this.servicesService.findOne(
                saved.serviceId,
                userId,
              );
              body = buildOnHostRedeployScriptBody(svc);
              saved.bashScript = body;
              await this.scopedWebhooks.saveScoped(saved, userId);
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
    const detail = await this.toDetailRow(saved, remoteTriggerUrl);
    this.logSecurityAudit(expectedOrg, userId, 'security.webhook.updated', endpoint, {
      webhookPublicId: saved.publicId,
      webhookName: saved.name,
      httpStatus: 200,
    });
    this.orgRealtime.notifyOrgDataChanged(expectedOrg, {
      entity: 'webhook',
      action: 'updated',
      publicId: saved.publicId,
      resourceId: saved.id,
    });
    return detail;
  }

  async remove(
    userId: number,
    idOrPublicId: string | number,
    organizationPublicId?: string | null,
  ): Promise<void> {
    const expectedOrg = await this.requireWorkspaceOrgId(
      userId,
      organizationPublicId,
      [ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_DELETE],
    );
    const endpoint = `DELETE /api/webhooks/${encodeURIComponent(String(idOrPublicId))}`;
    let w: Webhook;
    try {
      w = await this.resolveEntity(userId, idOrPublicId);
      this.assertWebhookWorkspace(w, expectedOrg);
    } catch (e) {
      this.logWebhookSecurityHttpDenial(
        expectedOrg,
        userId,
        'security.webhook.deleted',
        endpoint,
        e,
      );
      throw e;
    }
    const ensured = await this.ensurePublicId(w);
    this.logSecurityAudit(expectedOrg, userId, 'security.webhook.deleted', endpoint, {
      webhookPublicId: ensured.publicId,
      webhookName: ensured.name,
      httpStatus: 200,
    });
    await this.deleteWebhookArtifacts(userId, w);
    if (expectedOrg >= 1) {
      this.orgRealtime.notifyOrgDataChanged(expectedOrg, {
        entity: 'webhook',
        action: 'deleted',
        publicId: ensured.publicId,
        resourceId: w.id,
      });
    }
  }

  /**
   * Deletes all webhooks tied to a service (DB rows, remote agent scripts, Swarm sync).
   * Called when a service is removed so tokens and scripts do not linger.
   */
  async removeAllForService(
    actingUserId: number,
    serviceId: number,
    projectUserId: number,
    projectOrganizationId: number,
  ): Promise<void> {
    const rows = await this._internal_system_findWebhooks({
      where: { serviceId, organizationId: projectOrganizationId },
    });
    for (const w of rows) {
      const ensured = await this.ensurePublicId(w);
      await assertOrganizationWorkspaceAccessForInternalId(
        this.organizationsRepository,
        actingUserId,
        projectOrganizationId,
        {
          requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS,
          requireAllWorkspaceAreas: [
            ORGANIZATION_WORKSPACE_PERMISSIONS.WEBHOOKS_DELETE,
          ],
        },
      );
      this.assertWebhookWorkspace(ensured, projectOrganizationId);
      await this.deleteWebhookArtifacts(actingUserId, ensured);
    }
    if (rows.length > 0 && projectOrganizationId >= 1) {
      this.orgRealtime.notifyOrgDataChanged(projectOrganizationId, {
        entity: 'webhook',
        action: 'deleted',
      });
    }
  }

  async triggerByToken(token: string): Promise<{ ok: boolean; message: string }> {
    const w = await this._internal_system_findBySecretToken(token);
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
            ? await this.servicesService.findOne(w.serviceId, w.userId)
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
            w.userId,
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

    const outputForLogs = output.slice(0, 32000);
    const payload = {
      ok: success,
      message: 'Triggered',
    };

    const logLine = [
      `public webhook trigger result`,
      `id=${w.publicId ?? w.id}`,
      `name=${w.name}`,
      `action=${actionLabel}`,
      `ok=${success}`,
      outputForLogs ? `output=${outputForLogs}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (success) {
      this.logger.log(logLine);
    } else {
      this.logger.warn(logLine);
    }

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
