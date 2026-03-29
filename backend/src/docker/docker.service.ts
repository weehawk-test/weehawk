import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  async getVolumes() {
    try {
      const { stdout: listOut } = await execAsync('docker volume ls -q');
      const names = listOut
        .trim()
        .split(/\r?\n/)
        .map((n) => n.trim())
        .filter(Boolean);
      if (names.length === 0) {
        return [];
      }

      let sizeByName = new Map<string, string>();
      try {
        const { stdout: dfOut } = await execAsync('docker system df -v');
        sizeByName = parseVolumeSizesFromSystemDfV(dfOut);
      } catch {
        /* optional; sizes stay unknown */
      }

      const chunkSize = 60;
      const merged: Array<{
        Name: string;
        CreatedAt: string;
        Size: string | null;
      }> = [];

      for (let i = 0; i < names.length; i += chunkSize) {
        const batch = names.slice(i, i + chunkSize);
        const { stdout: inspectOut } = await execFileAsync('docker', [
          'volume',
          'inspect',
          ...batch,
        ]);
        const parsed = JSON.parse(inspectOut) as VolumeInspectRow | VolumeInspectRow[];
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const v of rows) {
          const n = v.Name;
          const created = v.CreatedAt ?? new Date().toISOString();
          const sz = sizeByName.get(n) ?? null;
          merged.push({ Name: n, CreatedAt: created, Size: sz });
        }
      }

      return merged;
    } catch (error) {
      rethrowDockerError(error, 'volumes');
    }
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
      const { stdout, stderr } = await execFileAsync('docker', ['rmi', '-f', imageRef], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const combined = `${stdout ?? ''}${stderr ?? ''}`.trim();
      // Defensive: treat daemon errors in output as failure even if the CLI exited 0 (rare).
      if (
        /error response from daemon|cannot remove|is being used|must be forced|has dependent|denied|conflict/i.test(
          combined,
        )
      ) {
        throw new InternalServerErrorException(
          combined || 'Docker refused to remove this image (it may be in use by a container).',
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
}
