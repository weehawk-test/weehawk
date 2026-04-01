import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { UpsertS3ProfileDto } from './dto/upsert-s3-profile.dto';

const execFileAsync = promisify(execFile);

type StoredS3Profile = {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  updatedAt: string;
};

type PublicS3Profile = Omit<StoredS3Profile, 'secretAccessKey'> & {
  secretAccessKeyMasked: string;
};

@Injectable()
export class S3Service {
  private readonly profilesDir = path.resolve(process.cwd(), 'storage');
  private readonly profilesFile = path.join(this.profilesDir, 's3-profiles.json');

  private assertNonEmpty(value: string, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${label} is required`);
    }
    return trimmed;
  }

  private normalizeProfile(input: UpsertS3ProfileDto): StoredS3Profile {
    return {
      name: this.assertNonEmpty(input.name, 'name'),
      endpoint: this.assertNonEmpty(input.endpoint, 'endpoint'),
      region: this.assertNonEmpty(input.region, 'region'),
      bucket: this.assertNonEmpty(input.bucket, 'bucket'),
      accessKeyId: this.assertNonEmpty(input.accessKeyId, 'accessKeyId'),
      secretAccessKey: this.assertNonEmpty(input.secretAccessKey, 'secretAccessKey'),
      forcePathStyle: Boolean(input.forcePathStyle),
      updatedAt: new Date().toISOString(),
    };
  }

  private maskSecret(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 6) return '*'.repeat(secret.length);
    return `${secret.slice(0, 3)}${'*'.repeat(secret.length - 6)}${secret.slice(-3)}`;
  }

  private toPublicProfile(profile: StoredS3Profile): PublicS3Profile {
    const { secretAccessKey, ...rest } = profile;
    return {
      ...rest,
      secretAccessKeyMasked: this.maskSecret(secretAccessKey),
    };
  }

  private async readProfiles(): Promise<StoredS3Profile[]> {
    try {
      const raw = await fs.readFile(this.profilesFile, 'utf8');
      const parsed = JSON.parse(raw) as StoredS3Profile[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return [];
      }
      throw new InternalServerErrorException('Failed to read S3 profiles');
    }
  }

  private async writeProfiles(profiles: StoredS3Profile[]) {
    await fs.mkdir(this.profilesDir, { recursive: true });
    await fs.writeFile(this.profilesFile, JSON.stringify(profiles, null, 2), 'utf8');
  }

  async listProfiles() {
    const profiles = await this.readProfiles();
    return profiles.map((p) => this.toPublicProfile(p));
  }

  async saveProfile(dto: UpsertS3ProfileDto) {
    const next = this.normalizeProfile(dto);
    const profiles = await this.readProfiles();
    const filtered = profiles.filter((p) => p.name !== next.name);
    const updated = [next, ...filtered].slice(0, 50);
    await this.writeProfiles(updated);
    return {
      success: true,
      profile: this.toPublicProfile(next),
    };
  }

  async deleteProfile(name: string) {
    const safeName = this.assertNonEmpty(name, 'name');
    const profiles = await this.readProfiles();
    const updated = profiles.filter((p) => p.name !== safeName);
    await this.writeProfiles(updated);
    return { success: true, name: safeName };
  }

  private buildRcloneArgs(input: UpsertS3ProfileDto) {
    const forcePathStyle = Boolean(input.forcePathStyle);
    const args = [
      'ls',
      '--s3-provider',
      'Other',
      '--s3-access-key-id',
      input.accessKeyId,
      '--s3-secret-access-key',
      input.secretAccessKey,
      '--s3-region',
      input.region,
      '--s3-endpoint',
      input.endpoint,
      '--s3-no-check-bucket',
      '--retries',
      '1',
      '--low-level-retries',
      '1',
      '--timeout',
      '10s',
      '--contimeout',
      '5s',
    ];
    if (forcePathStyle) {
      args.push('--s3-force-path-style');
    }
    args.push(`:s3:${input.bucket}`);
    return args;
  }

  async testConnection(dto: UpsertS3ProfileDto) {
    const input = this.normalizeProfile(dto);
    try {
      const args = this.buildRcloneArgs(input);
      await execFileAsync('rclone', args);
      return { success: true, message: 'S3 connection verified via rclone' };
    } catch (error) {
      const e = error as Error & { stderr?: string; stdout?: string };
      const detail = (e.stderr || e.stdout || e.message || 'unknown error').trim();
      throw new InternalServerErrorException(`rclone test failed: ${detail}`);
    }
  }
}
