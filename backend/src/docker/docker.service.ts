import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  filterContainers,
  filterImages,
  filterNetworks,
  filterVolumes,
  mapRawRowsToContainers,
  mapRawRowsToImages,
  mapRawRowsToNetworks,
  mapRawRowsToVolumes,
} from './docker-row.mapper';
import {
  countByStatus,
  type PaginatedContainersDto,
  type PaginatedImagesDto,
  type PaginatedNetworksDto,
  type PaginatedVolumesDto,
} from './dto/paginated-list.dto';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** True when the docker CLI cannot talk to the daemon (not running, wrong context, etc.) */
function isDockerDaemonUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.toLowerCase();
  return (
    m.includes('cannot connect to the docker daemon') ||
    m.includes('failed to connect to the docker') ||
    m.includes('is the docker daemon running') ||
    m.includes('dockerdesktoplinuxengine') ||
    m.includes('npipe://') ||
    m.includes('docker_desktop') ||
    (m.includes('docker.sock') &&
      (m.includes('connection refused') || m.includes('no such file'))) ||
    (m.includes('pipe') && m.includes('docker'))
  );
}

function rethrowDockerError(err: unknown, label: string): never {
  if (isDockerDaemonUnreachable(err)) {
    throw new ServiceUnavailableException(
      'Docker is not running or not reachable from the API. On Windows or macOS, start Docker Desktop; on Linux, start the docker service. Then retry.',
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  throw new InternalServerErrorException(`Failed to fetch ${label}: ${msg}`);
}

/** Prefer `stderr`/`stdout` from `execFile` failures — Docker often puts the real reason there. */
function execFileErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as Error & {
    stderr?: Buffer | string;
    stdout?: Buffer | string;
    code?: string | number;
  };
  const stderr = e.stderr != null ? String(e.stderr).trim() : '';
  const stdout = e.stdout != null ? String(e.stdout).trim() : '';
  const base = e.message ?? 'Command failed';
  const detail = stderr || stdout;
  if (detail && !base.includes(detail.slice(0, Math.min(80, detail.length)))) {
    return `${base}\n${detail}`;
  }
  return base;
}

function rethrowDockerMutateError(err: unknown, label: string): never {
  if (isDockerDaemonUnreachable(err)) {
    throw new ServiceUnavailableException(
      'Docker is not running or not reachable from the API. Start Docker Desktop or the docker service, then retry.',
    );
  }
  const msg = execFileErrorMessage(err);
  throw new InternalServerErrorException(`${label}: ${msg}`);
}

function assertNonEmptyParam(value: string, label: string): string {
  const t = value?.trim();
  if (!t) throw new BadRequestException(`${label} is required`);
  return t;
}

/** Parse `docker system df -v` Local Volumes table: NAME, LINKS, SIZE */
function parseVolumeSizesFromSystemDfV(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = stdout.split(/\r?\n/);
  let inLocalVolumesTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.includes('VOLUME NAME') &&
      (trimmed.includes('LINKS') || trimmed.includes('SIZE'))
    ) {
      inLocalVolumesTable = true;
      continue;
    }
    if (!inLocalVolumesTable || !trimmed) continue;
    if (
      /^(Images|Containers|Build Cache|Local Volumes)(\s|$)/i.test(trimmed) &&
      !trimmed.includes('LINKS')
    ) {
      if (/^(Images|Containers|Build Cache)\b/i.test(trimmed)) {
        inLocalVolumesTable = false;
      }
      continue;
    }
    const cols = trimmed.split(/\s{2,}|\t/).map((c) => c.trim());
    if (cols.length >= 3 && /^\d+$/.test(cols[cols.length - 2])) {
      const size = cols[cols.length - 1];
      const name = cols.slice(0, cols.length - 2).join(' ');
      if (name && size && !/^N\/A$/i.test(size)) {
        map.set(name, size.trim());
      }
    }
  }
  return map;
}

type VolumeInspectRow = {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  CreatedAt?: string;
};

@Injectable()
export class DockerService {
  /**
   * Cache the (expensive) `docker system df -v` parsed map briefly.
   * This command is noticeably slower than `docker volume ls`.
   */
  private volumeSizeCache: {
    at: number;
    ttlMs: number;
    map: Map<string, string>;
  } | null = null;

  private clampPage(page: number): number {
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }

  private clampPageSize(size: number): number {
    const n = Number.isFinite(size) ? Math.floor(size) : 10;
    return Math.min(Math.max(n, 1), 100);
  }

  async getContainers() {
    try {
      const { stdout } = await execAsync('docker ps -a --format "{{json .}}"');
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      rethrowDockerError(error, 'containers');
    }
  }

  async getContainersPaged(
    pageRaw: number,
    pageSizeRaw: number,
    search: string,
  ): Promise<PaginatedContainersDto> {
    const page = this.clampPage(pageRaw);
    const pageSize = this.clampPageSize(pageSizeRaw);
    const raw = await this.getContainers();
    const mapped = mapRawRowsToContainers(raw as unknown[]);
    const counts = countByStatus(mapped);
    const filtered = filterContainers(mapped, search ?? '');
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    return {
      items,
      total,
      totalAll: mapped.length,
      page,
      pageSize,
      counts,
    };
  }

  async getImages() {
    try {
      const { stdout } = await execAsync(
        'docker images --no-trunc --format "{{json .}}"',
      );
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      rethrowDockerError(error, 'images');
    }
  }

  async getImagesPaged(
    pageRaw: number,
    pageSizeRaw: number,
    search: string,
  ): Promise<PaginatedImagesDto> {
    const page = this.clampPage(pageRaw);
    const pageSize = this.clampPageSize(pageSizeRaw);
    const raw = await this.getImages();
    const mapped = mapRawRowsToImages(raw as unknown[]);
    const filtered = filterImages(mapped, search ?? '');
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

  async getVolumes() {
    try {
      const names = await this.listVolumeNames();
      if (names.length === 0) return [];

      const sizeByName = await this.getVolumeSizesCached();
      const inspected = await this.inspectVolumes(names);

      return inspected.map((v) => ({
        Name: v.Name,
        CreatedAt: v.CreatedAt ?? new Date().toISOString(),
        Size: sizeByName.get(v.Name) ?? null,
      }));
    } catch (error) {
      rethrowDockerError(error, 'volumes');
    }
  }

  async getVolumesPaged(
    pageRaw: number,
    pageSizeRaw: number,
    search: string,
    includeSizes = false,
  ): Promise<PaginatedVolumesDto> {
    const page = this.clampPage(pageRaw);
    const pageSize = this.clampPageSize(pageSizeRaw);

    // Optimization: paginate BEFORE `docker volume inspect` (and before size lookup).
    // `docker system df -v` is expensive; keep it cached briefly.
    const allNames = await this.listVolumeNames();
    const q = (search ?? '').trim().toLowerCase();
    const filteredNames = q
      ? allNames.filter((n) => n.toLowerCase().includes(q))
      : allNames;

    const total = filteredNames.length;
    const start = (page - 1) * pageSize;
    const pageNames = filteredNames.slice(start, start + pageSize);

    const sizeByName = includeSizes
      ? await this.getVolumeSizesCached()
      : new Map<string, string>();
    const inspected =
      pageNames.length > 0 ? await this.inspectVolumes(pageNames) : [];

    const merged = inspected.map((v) => ({
      Name: v.Name,
      CreatedAt: v.CreatedAt ?? new Date().toISOString(),
      Size: sizeByName.get(v.Name) ?? null,
    }));

    const mapped = mapRawRowsToVolumes(merged as unknown[]);
    const items = filterVolumes(mapped, '') // keep mapper behavior; search already applied above
      .slice(0, pageSize);

    return {
      items,
      total,
      totalAll: allNames.length,
      page,
      pageSize,
    };
  }

  private async listVolumeNames(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('docker volume ls -q');
      return stdout
        .trim()
        .split(/\r?\n/)
        .map((n) => n.trim())
        .filter(Boolean);
    } catch (error) {
      rethrowDockerError(error, 'volume names');
    }
  }

  private async getVolumeSizesCached(): Promise<Map<string, string>> {
    const ttlMs = 30_000;
    const now = Date.now();
    if (
      this.volumeSizeCache &&
      now - this.volumeSizeCache.at < this.volumeSizeCache.ttlMs
    ) {
      return this.volumeSizeCache.map;
    }
    try {
      const { stdout } = await execAsync('docker system df -v');
      const map = parseVolumeSizesFromSystemDfV(stdout);
      this.volumeSizeCache = { at: now, ttlMs, map };
      return map;
    } catch {
      // Optional; sizes stay unknown.
      const map = new Map<string, string>();
      this.volumeSizeCache = { at: now, ttlMs, map };
      return map;
    }
  }

  private async inspectVolumes(names: string[]): Promise<VolumeInspectRow[]> {
    if (names.length === 0) return [];
    const chunkSize = 60;
    const rows: VolumeInspectRow[] = [];
    for (let i = 0; i < names.length; i += chunkSize) {
      const batch = names.slice(i, i + chunkSize);
      const { stdout: inspectOut } = await execFileAsync('docker', [
        'volume',
        'inspect',
        ...batch,
      ]);
      const parsed = JSON.parse(inspectOut) as
        | VolumeInspectRow
        | VolumeInspectRow[];
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      rows.push(...arr);
    }
    return rows;
  }

  async getNetworks() {
    try {
      const { stdout } = await execAsync(
        'docker network ls --no-trunc --format "{{json .}}"',
      );
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      rethrowDockerError(error, 'networks');
    }
  }

  async getNetworksPaged(
    pageRaw: number,
    pageSizeRaw: number,
    search: string,
  ): Promise<PaginatedNetworksDto> {
    const page = this.clampPage(pageRaw);
    const pageSize = this.clampPageSize(pageSizeRaw);
    const raw = await this.getNetworks();
    const mapped = mapRawRowsToNetworks(raw as unknown[]);
    const filtered = filterNetworks(mapped, search ?? '');
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

  async getSystemStats() {
    try {
      const { stdout } = await execAsync(
        'docker stats --no-stream --format "{{json .}}"',
      );
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (isDockerDaemonUnreachable(error)) {
        return [];
      }
      return [];
    }
  }

  /**
   * Last lines of stdout/stderr from `docker logs` (with timestamps).
   * `tail` is clamped to 1–10000.
   */
  async getContainerLogs(idOrName: string, tail = 500) {
    const target = assertNonEmptyParam(idOrName, 'Container id or name');
    const n = Math.min(Math.max(Number(tail) || 500, 1), 10000);
    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'logs',
        '--tail',
        String(n),
        '--timestamps',
        target,
      ]);
      const combined = [stdout, stderr].filter(Boolean).join('\n');
      return { logs: combined.trimEnd() };
    } catch (error) {
      rethrowDockerError(error, 'container logs');
    }
  }

  /** Remove container (force-stops if running). */
  async removeContainer(idOrName: string) {
    const target = assertNonEmptyParam(idOrName, 'Container id or name');
    try {
      await execFileAsync('docker', ['rm', '-f', target]);
      return { success: true };
    } catch (error) {
      rethrowDockerMutateError(error, 'Failed to remove container');
    }
  }

  /** Remove image by reference (repo:tag, digest, or image id). */
  async removeImage(ref: string) {
    const imageRef = assertNonEmptyParam(ref, 'Image reference');
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['rmi', '-f', imageRef],
        {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      const combined = `${stdout ?? ''}${stderr ?? ''}`.trim();
      // Defensive: treat daemon errors in output as failure even if the CLI exited 0 (rare).
      if (
        /error response from daemon|cannot remove|is being used|must be forced|has dependent|denied|conflict/i.test(
          combined,
        )
      ) {
        throw new InternalServerErrorException(
          combined ||
            'Docker refused to remove this image (it may be in use by a container).',
        );
      }
      return { success: true };
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      rethrowDockerMutateError(error, 'Failed to remove image');
    }
  }

  /** Remove a named volume. */
  async removeVolume(name: string) {
    const volumeName = assertNonEmptyParam(name, 'Volume name');
    try {
      await execFileAsync('docker', ['volume', 'rm', volumeName]);
      return { success: true };
    } catch (error) {
      rethrowDockerMutateError(error, 'Failed to remove volume');
    }
  }

  /** Remove a network by name or ID (fails for in-use or predefined networks). */
  async removeNetwork(idOrName: string) {
    const target = assertNonEmptyParam(idOrName, 'Network id or name');
    try {
      await execFileAsync('docker', ['network', 'rm', target]);
      return { success: true };
    } catch (error) {
      rethrowDockerMutateError(error, 'Failed to remove network');
    }
  }
}
