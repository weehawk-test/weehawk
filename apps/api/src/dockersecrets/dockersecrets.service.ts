import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  filterSecrets,
  mapDockerSecretLsRow,
  type DockerSecretListItemDto,
} from './docker-secret-row.mapper';
import { RemoteServersService } from '../remote-servers/remote-servers.service';
import { OrgRealtimeEmitter } from '../org-realtime/org-realtime-emitter.service';
import { OrganizationsService } from '../organizations/organizations.service';

function clampPage(page: number): number {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function clampPageSize(size: number): number {
  const n = Number.isFinite(size) ? Math.floor(size) : 10;
  return Math.min(Math.max(n, 1), 100);
}

/** Dotenv-style lines for bulk import (not a full dotenv parser). */
function parseDotenvLinesForBulkImport(
  envText: string,
): Array<{ name: string; value: string }> {
  const normalized = envText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const out: Array<{ name: string; value: string }> = [];
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^export\s+/i.test(trimmed)) {
      trimmed = trimmed.replace(/^export\s+/i, '').trim();
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const rawKey = trimmed.slice(0, eq).trim();
    if (!rawKey) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ name: rawKey, value });
  }
  return out;
}

export interface PaginatedSecretsDto {
  items: DockerSecretListItemDto[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class DockerSecretsService {
  private readonly logger = new Logger(DockerSecretsService.name);

  /** Avoid hammering SSH for every RSC refresh; invalidated on mutations. */
  private static readonly REMOTE_LIST_CACHE_TTL_MS = 4000;

  private readonly remoteListCache = new Map<
    string,
    { expiresAt: number; rows: unknown[] }
  >();
  private readonly remoteListInflight = new Map<string, Promise<unknown[]>>();

  constructor(
    private readonly remoteServersService: RemoteServersService,
    private readonly orgRealtime: OrgRealtimeEmitter,
    private readonly organizationsService: OrganizationsService,
  ) {}

  private appendDockerSwarmSecretAudit(
    remoteServerId: number,
    actorUserId: number,
    action: string,
    metadata: Record<string, unknown>,
  ): void {
    void (async () => {
      const ctx =
        await this.remoteServersService.resolveRemoteServerAuditFields(
          remoteServerId,
          actorUserId,
        );
      if (ctx == null) {
        return;
      }
      await this.organizationsService.appendOrganizationAuditEvent(
        ctx.organizationInternalId,
        actorUserId,
        action,
        {
          metadata: {
            ...metadata,
            remoteServerPublicId: ctx.publicId,
            remoteServerName: ctx.name,
          },
        },
      );
    })().catch(() => undefined);
  }

  private async notifyOrgSecretsChanged(
    remoteServerId: number,
    projectUserId: number | null,
    action: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    if (projectUserId == null) return;
    const orgId = await this.remoteServersService.getOrganizationIdForUserServer(
      remoteServerId,
      projectUserId,
    );
    if (orgId == null) return;
    this.orgRealtime.notifyOrgDataChanged(orgId, {
      entity: 'docker_secret',
      action,
    });
  }

  private listCacheKey(
    remoteServerId: number,
    projectUserId: number | null,
  ): string {
    return `${remoteServerId}:${projectUserId ?? 'anon'}`;
  }

  private invalidateRemoteListCache(
    remoteServerId: number,
    projectUserId: number | null,
  ): void {
    this.remoteListCache.delete(
      this.listCacheKey(remoteServerId, projectUserId),
    );
  }

  async create(
    remoteServerId: number,
    projectUserId: number | null,
    name: string,
    value: string,
  ): Promise<void> {
    await this.remoteServersService.ensureDockerSecretOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      name,
      value,
    );
    this.invalidateRemoteListCache(remoteServerId, projectUserId);
    await this.notifyOrgSecretsChanged(remoteServerId, projectUserId, 'created');
    if (projectUserId != null) {
      this.appendDockerSwarmSecretAudit(
        remoteServerId,
        projectUserId,
        'security.remote_docker.swarm_secret_created',
        {
          endpoint: 'POST /api/docker-secrets',
          secretName: name.trim().slice(0, 256),
        },
      );
    }
  }

  async bulkImportFromEnvText(
    remoteServerId: number,
    projectUserId: number | null,
    envText: string,
  ): Promise<{
    message: string;
    created: string[];
    failed: Array<{ key: string; error: string }>;
    skipped: string[];
  }> {
    const entries = parseDotenvLinesForBulkImport(envText);
    const { created, failed, skipped } =
      await this.remoteServersService.bulkEnsureDockerSecretsOnRemoteViaSsh(
        remoteServerId,
        projectUserId,
        entries,
      );
    const parts: string[] = [`${created.length} created`];
    if (skipped.length) parts.push(`${skipped.length} already existed (skipped)`);
    if (failed.length) parts.push(`${failed.length} failed`);
    const out = {
      message: parts.join(', ') + '.',
      created,
      failed,
      skipped,
    };
    this.invalidateRemoteListCache(remoteServerId, projectUserId);
    if (created.length > 0) {
      await this.notifyOrgSecretsChanged(remoteServerId, projectUserId, 'updated');
    }
    if (projectUserId != null) {
      this.appendDockerSwarmSecretAudit(
        remoteServerId,
        projectUserId,
        'security.remote_docker.swarm_secrets_bulk_imported',
        {
          endpoint: 'POST /api/docker-secrets/bulk-import',
          bulkImportMessage: out.message.slice(0, 500),
          bulkCreatedCount: created.length,
          bulkSkippedCount: skipped.length,
          bulkFailedCount: failed.length,
        },
      );
    }
    return out;
  }

  private async fetchRemoteSecretLsRows(
    remoteServerId: number,
    projectUserId: number | null,
  ): Promise<unknown[]> {
    const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
      remoteServerId,
      projectUserId,
      `docker secret ls --format '{{json .}}'`,
    );
    const stdout = r.stdout.trim();
    if (!stdout) return [];
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async findAll(remoteServerId: number, projectUserId: number | null) {
    const key = this.listCacheKey(remoteServerId, projectUserId);
    const now = Date.now();
    const hit = this.remoteListCache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.rows;
    }

    if (!this.remoteListInflight.has(key)) {
      const p = this.fetchRemoteSecretLsRows(remoteServerId, projectUserId)
        .then((rows) => {
          this.remoteListCache.set(key, {
            expiresAt: Date.now() + DockerSecretsService.REMOTE_LIST_CACHE_TTL_MS,
            rows,
          });
          return rows;
        })
        .finally(() => {
          this.remoteListInflight.delete(key);
        });
      this.remoteListInflight.set(key, p);
    }

    try {
      return await this.remoteListInflight.get(key)!;
    } catch (e) {
      this.logger.error(
        `Could not list secrets on remote #${remoteServerId}.`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Could not retrieve secrets from remote server',
      );
    }
  }

  async findAllPaged(
    remoteServerId: number,
    projectUserId: number | null,
    pageRaw: number,
    pageSizeRaw: number,
    search: string,
  ): Promise<PaginatedSecretsDto> {
    const page = clampPage(pageRaw);
    const pageSize = clampPageSize(pageSizeRaw);
    const raw = await this.findAll(remoteServerId, projectUserId);
    const mapped = (raw as unknown[]).map((row, i) =>
      mapDockerSecretLsRow(row as Record<string, unknown>, i),
    );
    const filtered = filterSecrets(mapped, search ?? '');
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    return {
      items,
      total,
      totalAll: mapped.length,
      page,
      pageSize,
    };
  }

  async findOne(
    remoteServerId: number,
    projectUserId: number | null,
    name: string,
  ) {
    try {
      const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
        remoteServerId,
        projectUserId,
        `docker secret inspect ${JSON.stringify(name)}`,
      );
      return JSON.parse(r.stdout)[0];
    } catch {
      throw new NotFoundException(`Secret ${name} not found`);
    }
  }

  async remove(
    remoteServerId: number,
    projectUserId: number | null,
    name: string,
    _force = false,
  ): Promise<{ success: boolean }> {
    await this.remoteServersService.dockerSecretRemovePruneViaSsh(
      remoteServerId,
      projectUserId,
      name,
    );
    this.invalidateRemoteListCache(remoteServerId, projectUserId);
    await this.notifyOrgSecretsChanged(remoteServerId, projectUserId, 'deleted');
    if (projectUserId != null) {
      this.appendDockerSwarmSecretAudit(
        remoteServerId,
        projectUserId,
        'security.remote_docker.swarm_secret_deleted',
        {
          endpoint: `DELETE /api/docker-secrets/${encodeURIComponent(name)}`,
          secretName: name.trim().slice(0, 256),
        },
      );
    }
    return { success: true };
  }

  async removePrune(
    remoteServerId: number,
    projectUserId: number | null,
    secretName: string,
  ): Promise<{ success: boolean }> {
    await this.remoteServersService.dockerSecretRemovePruneViaSsh(
      remoteServerId,
      projectUserId,
      secretName,
    );
    this.invalidateRemoteListCache(remoteServerId, projectUserId);
    await this.notifyOrgSecretsChanged(remoteServerId, projectUserId, 'deleted');
    if (projectUserId != null) {
      this.appendDockerSwarmSecretAudit(
        remoteServerId,
        projectUserId,
        'security.remote_docker.swarm_secret_deleted',
        {
          endpoint: `DELETE /api/docker-secrets/${encodeURIComponent(secretName)}`,
          secretName: secretName.trim().slice(0, 256),
        },
      );
    }
    return { success: true };
  }
}
