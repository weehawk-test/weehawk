import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import {
  filterSecrets,
  mapDockerSecretLsRow,
  type DockerSecretListItemDto,
} from './docker-secret-row.mapper';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  /** Resolve Swarm secret ID for matching against service spec (SecretName can be omitted in some engines). */
  private async resolveSecretId(secretName: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'secret',
        'inspect',
        secretName,
        '--format',
        '{{.ID}}',
      ]);
      const id = stdout.trim();
      return id || undefined;
    } catch {
      return undefined;
    }
  }

  private async forceDetachSecretFromServices(secretName: string): Promise<void> {
    try {
      const secretId = await this.resolveSecretId(secretName);
      const { stdout } = await execAsync('docker service ls -q');
      const serviceIds = stdout
        .trim()
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const serviceId of serviceIds) {
        try {
          const { stdout: inspectOut } = await execFileAsync('docker', [
            'service',
            'inspect',
            serviceId,
          ]);
          const parsed = JSON.parse(inspectOut) as Array<{
            Spec?: {
              TaskTemplate?: {
                ContainerSpec?: {
                  Secrets?: Array<{
                    SecretID?: string;
                    SecretName?: string;
                    File?: { Name?: string };
                  }>;
                };
              };
            };
          }>;
          const item = Array.isArray(parsed) ? parsed[0] : undefined;
          const secrets =
            item?.Spec?.TaskTemplate?.ContainerSpec?.Secrets ?? [];
          const matched = secrets.find((s) => {
            if (secretId && s?.SecretID === secretId) return true;
            if (s?.SecretName === secretName) return true;
            if (s?.File?.Name === secretName) return true;
            return false;
          });
          if (!matched) continue;
          const rmCandidates = Array.from(
            new Set(
              [secretName, matched?.SecretName, matched?.File?.Name]
                .map((v) => (v ?? '').trim())
                .filter(Boolean),
            ),
          );
          let detached = false;
          for (const rm of rmCandidates) {
            try {
              await execFileAsync('docker', [
                'service',
                'update',
                '--secret-rm',
                rm,
                serviceId,
              ]);
              detached = true;
              break;
            } catch {
              // Try next candidate name.
            }
          }
          if (!detached) {
            // Fall back to remove flow retries; this service may reject update now.
            continue;
          }
        } catch {
          // Best effort only.
        }
      }
    } catch {
      // Swarm may be unavailable, keep default error behavior.
    }
  }

  /**
   * Remove a Swarm secret after it is no longer referenced in compose.
   * Detaches from every service first (generate/upload runs before stack redeploy, so the
   * secret is often still attached — plain `docker secret rm` fails with "in use").
   */
  async removePrune(secretName: string): Promise<{ success: boolean }> {
    await this.forceDetachSecretFromServices(secretName);
    await sleep(800);
    return this.remove(secretName, true);
  }

  async create(name: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['secret', 'create', name, '-']);

      if (!child.stdin) {
        return reject(
          new InternalServerErrorException('Stdin pipe not available'),
        );
      }

      child.stdin.write(value);
      child.stdin.end();

      let stderr = '';
      child.stderr.on('data', (data) => (stderr += data.toString()));

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Exit code ${code}`));
      });
    });
  }

  async findAll() {
    try {
      const { stdout } = await execAsync(
        'docker secret ls --format "{{json .}}"',
      );
      if (!stdout.trim()) return [];
      return stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    } catch (e) {
      throw new InternalServerErrorException('Docker Swarm mode is required');
    }
  }

  async findAllPaged(
    pageRaw: number,
    pageSizeRaw: number,
    search: string,
  ): Promise<PaginatedSecretsDto> {
    const page = clampPage(pageRaw);
    const pageSize = clampPageSize(pageSizeRaw);
    const raw = await this.findAll();
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

  async findOne(name: string) {
    try {
      const { stdout } = await execAsync(`docker secret inspect ${name}`);
      return JSON.parse(stdout)[0];
    } catch (e) {
      throw new NotFoundException(`Secret ${name} not found`);
    }
  }

  async remove(name: string, force = false) {
    let lastError = '';
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        await execAsync(`docker secret rm ${name}`);
        return { success: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = msg;
        // Stack/service teardown can be asynchronous; retry when secret is still in use.
        if (/in use|being used|currently in use/i.test(msg) && attempt < 6) {
          if (force && attempt === 1) {
            await this.forceDetachSecretFromServices(name);
          }
          await sleep(1200 * attempt);
          continue;
        }
        throw new InternalServerErrorException(
          `Could not remove secret ${name}: ${msg}`,
        );
      }
    }
    throw new InternalServerErrorException(
      `Could not remove secret ${name}: ${lastError}`,
    );
  }
}
