import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

@Injectable()
export class RegistryService {
  private assertNonEmpty(value: string, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${label} is required`);
    }
    return trimmed;
  }

  private async runDockerWithOptionalStdin(
    args: string[],
    stdinPayload?: string,
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
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

  async login(providerUrl: string, username: string, password: string) {
    const safeProviderUrl = this.assertNonEmpty(providerUrl, 'providerUrl');
    const safeUsername = this.assertNonEmpty(username, 'username');
    const safePassword = this.assertNonEmpty(password, 'password');

    try {
      const result = await this.runDockerWithOptionalStdin(
        ['login', safeProviderUrl, '--username', safeUsername, '--password-stdin'],
        `${safePassword}\n`,
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
    const safeProviderUrl = this.assertNonEmpty(providerUrl, 'providerUrl');

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
    await this.login(providerUrl, username, password);

    // Keep credentials out of local Docker config for verification-only checks.
    try {
      await this.logout(providerUrl);
    } catch {
      // Best-effort cleanup only.
    }

    return {
      success: true,
      message: 'Registry credentials are valid',
    };
  }
}
