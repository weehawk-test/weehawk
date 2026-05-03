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

  constructor(private readonly remoteServersService: RemoteServersService) {}

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
    return {
      message: parts.join(', ') + '.',
      created,
      failed,
      skipped,
    };
  }

  async findAll(remoteServerId: number, projectUserId: number | null) {
    try {
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
    return { success: true };
  }
}
