import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import {
  filterSecrets,
  mapDockerSecretLsRow,
  type DockerSecretListItemDto,
} from './docker-secret-row.mapper';

const execAsync = promisify(exec);

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
  async create(name: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['secret', 'create', name, '-']);

      if (!child.stdin) {
        return reject(new InternalServerErrorException('Stdin pipe not available'));
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
      const { stdout } = await execAsync('docker secret ls --format "{{json .}}"');
      if (!stdout.trim()) return [];
      return stdout.trim().split('\n').map((line) => JSON.parse(line));
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

  async remove(name: string) {
    try {
      await execAsync(`docker secret rm ${name}`);
      return { success: true };
    } catch (e) {
      throw new InternalServerErrorException(`Could not remove secret ${name}`);
    }
  }
}