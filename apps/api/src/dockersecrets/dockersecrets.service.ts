import {
  Injectable,
  InternalServerErrorException,
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

export interface PaginatedSecretsDto {
  items: DockerSecretListItemDto[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class DockerSecretsService {
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
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Could not list secrets on remote #${remoteServerId}: ${msg}`,
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
