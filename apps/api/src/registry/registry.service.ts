import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { encryptPrivateKey, decryptPrivateKey } from '../remote-servers/ssh-key-crypto';
import { RegistryAccount } from './entities/registry-account.entity';
import type { CreateRegistryAccountDto } from './dto/create-registry-account.dto';
import {
  normalizeProviderUrl,
  registryHostFromImageRef,
} from './registry-host-from-image';

const execFileAsync = promisify(execFile);

type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RegistryAccountSafe = {
  id: number;
  name: string;
  providerUrl: string;
  username: string;
  lastVerifiedAt: string | null;
};

@Injectable()
export class RegistryService {
  constructor(
    @InjectRepository(RegistryAccount)
    private readonly registryAccountRepository: Repository<RegistryAccount>,
    private readonly configService: ConfigService,
  ) {}

  private assertNonEmpty(value: string, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${label} is required`);
    }
    return trimmed;
  }

  private getEncryptionSecret(): string {
    const s = this.configService.get<string>('WEEHAWK_ENCRYPTION_KEY');
    if (!s || !String(s).trim()) {
      throw new BadRequestException(
        'WEEHAWK_ENCRYPTION_KEY is not set. It is required to store registry passwords in the database.',
      );
    }
    return String(s).trim();
  }

  private async runDockerWithOptionalStdin(
    args: string[],
    stdinPayload?: string,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => reject(err));

      child.on('close', (code) => {
        resolve({
          code: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      if (stdinPayload != null) {
        if (!child.stdin) {
          reject(new InternalServerErrorException('Docker stdin is unavailable'));
          return;
        }
        child.stdin.write(stdinPayload);
      }

      child.stdin?.end();
    });
  }

  toSafe(row: RegistryAccount): RegistryAccountSafe {
    return {
      id: row.id,
      name: row.name,
      providerUrl: row.providerUrl,
      username: row.username,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    };
  }

  async listAccounts(): Promise<RegistryAccountSafe[]> {
    const rows = await this.registryAccountRepository.find({
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.toSafe(r));
  }

  async createAccount(dto: CreateRegistryAccountDto): Promise<RegistryAccountSafe> {
    const providerUrl = normalizeProviderUrl(dto.providerUrl);
    if (!providerUrl) {
      throw new BadRequestException('providerUrl is required');
    }
    const name = dto.name.trim();
    const username = dto.username.trim();
    const password = dto.password;

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'weehawk-reg-'));
    try {
      const isolatedEnv = { ...process.env, DOCKER_CONFIG: tmp };
      const result = await this.runDockerWithOptionalStdin(
        ['login', providerUrl, '--username', username, '--password-stdin'],
        `${password}\n`,
        isolatedEnv,
      );
      if (result.code !== 0) {
        throw new UnauthorizedException(
          result.stderr ||
            result.stdout ||
            `Docker login failed for registry "${providerUrl}"`,
        );
      }

      const enc = encryptPrivateKey(password, this.getEncryptionSecret());
      const existing = await this.registryAccountRepository.findOne({
        where: { providerUrl },
      });
      if (existing) {
        existing.name = name;
        existing.username = username;
        existing.passwordEncrypted = enc;
        existing.lastVerifiedAt = new Date();
        const saved = await this.registryAccountRepository.save(existing);
        return this.toSafe(saved);
      }
      const created = this.registryAccountRepository.create({
        name,
        providerUrl,
        username,
        passwordEncrypted: enc,
        lastVerifiedAt: new Date(),
      });
      const saved = await this.registryAccountRepository.save(created);
      return this.toSafe(saved);
    } catch (e) {
      if (e instanceof UnauthorizedException || e instanceof BadRequestException) {
        throw e;
      }
      const message = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(`Registry save failed: ${message}`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  async removeAccount(id: number): Promise<{ success: true }> {
    const row = await this.registryAccountRepository.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Registry account #${id} not found`);
    await this.registryAccountRepository.remove(row);
    return { success: true };
  }

  /**
   * Merge credentials from DB into env via isolated DOCKER_CONFIG (Dokploy-style: no reliance on host ~/.docker only).
   */
  async mergePushEnvForImageRef(
    imageRef: string,
    base: NodeJS.ProcessEnv,
  ): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
    const host = registryHostFromImageRef(imageRef);
    const normalized = normalizeProviderUrl(host);
    const account = await this.registryAccountRepository.findOne({
      where: { providerUrl: normalized },
    });
    if (!account) {
      return {
        env: base,
        cleanup: async () => {},
      };
    }

    let password: string;
    try {
      password = decryptPrivateKey(
        account.passwordEncrypted,
        this.getEncryptionSecret(),
      );
    } catch {
      return { env: base, cleanup: async () => {} };
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'weehawk-docker-push-'));
    const auth = Buffer.from(`${account.username}:${password}`, 'utf8').toString(
      'base64',
    );
    const auths: Record<string, { auth: string }> = {
      [account.providerUrl]: { auth },
    };
    if (account.providerUrl === 'docker.io') {
      auths['https://index.docker.io/v1/'] = { auth };
    }

    try {
      await fs.writeFile(
        path.join(tmp, 'config.json'),
        JSON.stringify({ auths }),
        'utf8',
      );
    } catch {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return { env: base, cleanup: async () => {} };
    }

    const env = { ...base, DOCKER_CONFIG: tmp };
    return {
      env,
      cleanup: async () => {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      },
    };
  }

  /**
   * Auth for Dockerode `Image.push` (Docker API / X-Registry-Auth), same credentials as mergePushEnvForImageRef.
   * Returns null when no account exists or decryption fails.
   */
  async getRegistryAuthConfigForImageRef(
    imageRef: string,
  ): Promise<{
    username: string;
    password: string;
    serveraddress: string;
  } | null> {
    const host = registryHostFromImageRef(imageRef);
    const normalized = normalizeProviderUrl(host);
    const account = await this.registryAccountRepository.findOne({
      where: { providerUrl: normalized },
    });
    if (!account) {
      return null;
    }
    let password: string;
    try {
      password = decryptPrivateKey(
        account.passwordEncrypted,
        this.getEncryptionSecret(),
      );
    } catch {
      return null;
    }
    const serveraddress =
      account.providerUrl === 'docker.io'
        ? 'https://index.docker.io/v1/'
        : `https://${account.providerUrl}`;
    return {
      username: account.username.trim(),
      password,
      serveraddress,
    };
  }

  /** Legacy: login writes host docker config (optional one-off). */
  async login(providerUrl: string, username: string, password: string) {
    const safeProviderUrl = normalizeProviderUrl(
      this.assertNonEmpty(providerUrl, 'providerUrl'),
    );
    const safeUsername = this.assertNonEmpty(username, 'username');
    const safePassword = this.assertNonEmpty(password, 'password');

    try {
      const result = await this.runDockerWithOptionalStdin(
        ['login', safeProviderUrl, '--username', safeUsername, '--password-stdin'],
        `${safePassword}\n`,
        process.env,
      );

      if (result.code !== 0) {
        throw new UnauthorizedException(
          result.stderr ||
            result.stdout ||
            `Docker login failed for registry "${safeProviderUrl}"`,
        );
      }

      return {
        success: true,
        providerUrl: safeProviderUrl,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Registry login failed: ${message}`,
      );
    }
  }

  async logout(providerUrl: string) {
    const safeProviderUrl = normalizeProviderUrl(
      this.assertNonEmpty(providerUrl, 'providerUrl'),
    );

    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'logout',
        safeProviderUrl,
      ]);

      return {
        success: true,
        providerUrl: safeProviderUrl,
        output: `${stdout ?? ''}${stderr ?? ''}`.trim(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Registry logout failed: ${message}`,
      );
    }
  }

  async verifyConnection(providerUrl: string, username: string, password: string) {
    const safeProviderUrl = normalizeProviderUrl(
      this.assertNonEmpty(providerUrl, 'providerUrl'),
    );
    const safeUsername = this.assertNonEmpty(username, 'username');
    const safePassword = this.assertNonEmpty(password, 'password');

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'weehawk-reg-verify-'));
    try {
      const isolatedEnv = { ...process.env, DOCKER_CONFIG: tmp };
      const result = await this.runDockerWithOptionalStdin(
        [
          'login',
          safeProviderUrl,
          '--username',
          safeUsername,
          '--password-stdin',
        ],
        `${safePassword}\n`,
        isolatedEnv,
      );
      if (result.code !== 0) {
        throw new UnauthorizedException(
          result.stderr ||
            result.stdout ||
            `Docker login failed for registry "${safeProviderUrl}"`,
        );
      }
      return {
        success: true,
        message: 'Registry credentials are valid',
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Registry verify failed: ${message}`,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
}
