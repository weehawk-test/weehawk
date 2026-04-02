import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Repository } from 'typeorm';
import { UpsertS3ProfileDto } from './dto/upsert-s3-profile.dto';
import { S3Profile } from './entities/s3-profile.entity';
import { inferS3ForcePathStyle } from './s3-force-path-style';
import { getErrorMessage } from '../utils/error-message';

const MAX_PROFILES = 50;

/** Legacy JSON storage path (migrated once on startup if DB is empty). */
function legacyProfilesFilePath(): string {
  return path.join(path.resolve(process.cwd(), 'storage'), 's3-profiles.json');
}

type PublicS3Profile = {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  createdAt: string;
  updatedAt: string;
  secretAccessKeyMasked: string;
};

type NormalizedS3Credentials = {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function createS3Client(input: NormalizedS3Credentials): S3Client {
  const endpoint = input.endpoint.trim();
  return new S3Client({
    region: input.region.trim(),
    endpoint: endpoint.length > 0 ? endpoint : undefined,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
    forcePathStyle: Boolean(input.forcePathStyle),
  });
}

function rowToCredentials(row: S3Profile): NormalizedS3Credentials {
  return {
    name: row.name,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    accessKeyId: row.accessKeyId,
    secretAccessKey: row.secretAccessKey,
    forcePathStyle: row.forcePathStyle,
  };
}

@Injectable()
export class S3Service implements OnModuleInit {
  constructor(
    @InjectRepository(S3Profile)
    private readonly profileRepo: Repository<S3Profile>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.migrateFromLegacyJsonIfNeeded();
  }

  private async migrateFromLegacyJsonIfNeeded(): Promise<void> {
    const legacyPath = legacyProfilesFilePath();
    let raw: string;
    try {
      raw = await fs.readFile(legacyPath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;

    const count = await this.profileRepo.count();
    if (count > 0) {
      try {
        await fs.rename(legacyPath, `${legacyPath}.bak`);
      } catch {
        /* ignore */
      }
      return;
    }

    const rows: S3Profile[] = [];
    for (const item of parsed.slice(0, MAX_PROFILES)) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      const name = String(p.name ?? '').trim();
      const endpoint = String(p.endpoint ?? '').trim();
      const region = String(p.region ?? '').trim();
      const bucket = String(p.bucket ?? '').trim();
      const accessKeyId = String(p.accessKeyId ?? '').trim();
      const secretAccessKey = String(p.secretAccessKey ?? '');
      if (!name || !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
        continue;
      }
      const row = this.profileRepo.create({
        name,
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle: Boolean(p.forcePathStyle),
      });
      rows.push(row);
    }
    if (rows.length === 0) {
      try {
        await fs.rename(legacyPath, `${legacyPath}.empty`);
      } catch {
        /* ignore */
      }
      return;
    }
    await this.profileRepo.save(rows);
    try {
      await fs.rename(legacyPath, `${legacyPath}.migrated`);
    } catch {
      try {
        await fs.unlink(legacyPath);
      } catch {
        /* ignore */
      }
    }
  }

  private assertNonEmpty(value: string, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${label} is required`);
    }
    return trimmed;
  }

  private normalizeProfileFields(input: UpsertS3ProfileDto): Omit<NormalizedS3Credentials, 'secretAccessKey'> {
    const endpoint = this.assertNonEmpty(input.endpoint, 'endpoint');
    return {
      name: this.assertNonEmpty(input.name, 'name'),
      endpoint,
      region: this.assertNonEmpty(input.region, 'region'),
      bucket: this.assertNonEmpty(input.bucket, 'bucket'),
      accessKeyId: this.assertNonEmpty(input.accessKeyId, 'accessKeyId'),
      forcePathStyle: inferS3ForcePathStyle(endpoint),
    };
  }

  private resolveSecretForSave(input: UpsertS3ProfileDto, existing: S3Profile | null): string {
    const trimmed = input.secretAccessKey?.trim() ?? '';
    if (trimmed) return trimmed;
    if (existing) return existing.secretAccessKey;
    throw new BadRequestException('secretAccessKey is required');
  }

  private normalizeProfile(input: UpsertS3ProfileDto): NormalizedS3Credentials {
    const base = this.normalizeProfileFields(input);
    const secretAccessKey = this.assertNonEmpty(input.secretAccessKey ?? '', 'secretAccessKey');
    return { ...base, secretAccessKey };
  }

  /** Short fixed-width mask for UI (does not scale with secret length). */
  private maskSecret(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 6) return '*'.repeat(secret.length);
    return `${secret.slice(0, 3)}••••••••${secret.slice(-3)}`;
  }

  private toPublicProfile(row: S3Profile): PublicS3Profile {
    return {
      name: row.name,
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: row.accessKeyId,
      forcePathStyle: row.forcePathStyle,
      createdAt: (row.createdAt ?? row.updatedAt).toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      secretAccessKeyMasked: this.maskSecret(row.secretAccessKey),
    };
  }

  async listProfiles() {
    const rows = await this.profileRepo.find({
      order: { updatedAt: 'DESC' },
      take: MAX_PROFILES,
    });
    return rows.map((p) => this.toPublicProfile(p));
  }

  async saveProfile(dto: UpsertS3ProfileDto) {
    const base = this.normalizeProfileFields(dto);
    let row = await this.profileRepo.findOne({ where: { name: base.name } });
    const secretAccessKey = this.resolveSecretForSave(dto, row);
    const n: NormalizedS3Credentials = { ...base, secretAccessKey };
    if (row) {
      row.endpoint = n.endpoint;
      row.region = n.region;
      row.bucket = n.bucket;
      row.accessKeyId = n.accessKeyId;
      row.secretAccessKey = n.secretAccessKey;
      row.forcePathStyle = n.forcePathStyle;
    } else {
      row = this.profileRepo.create({
        name: n.name,
        endpoint: n.endpoint,
        region: n.region,
        bucket: n.bucket,
        accessKeyId: n.accessKeyId,
        secretAccessKey: n.secretAccessKey,
        forcePathStyle: n.forcePathStyle,
      });
    }
    await this.profileRepo.save(row);

    const all = await this.profileRepo.find({ order: { updatedAt: 'DESC' } });
    if (all.length > MAX_PROFILES) {
      await this.profileRepo.remove(all.slice(MAX_PROFILES));
    }

    const saved = await this.profileRepo.findOne({ where: { name: n.name } });
    if (!saved) {
      throw new InternalServerErrorException('Failed to persist S3 profile');
    }
    return {
      success: true,
      profile: this.toPublicProfile(saved),
    };
  }

  async deleteProfile(name: string) {
    const safeName = this.assertNonEmpty(name, 'name');
    await this.profileRepo.delete({ name: safeName });
    return { success: true, name: safeName };
  }

  async testConnection(dto: UpsertS3ProfileDto) {
    const input = this.normalizeProfile(dto);
    const client = createS3Client(input);
    try {
      await client.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          MaxKeys: 1,
        }),
      );
      return {
        success: true,
        message: 'S3 connection verified (ListObjectsV2)',
      };
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'unknown error';
      throw new InternalServerErrorException(`S3 connection failed: ${msg}`);
    } finally {
      client.destroy();
    }
  }

  async assertProfileExists(name: string): Promise<void> {
    const safe = name?.trim();
    if (!safe) {
      throw new BadRequestException('S3 profile name is required.');
    }
    const row = await this.profileRepo.findOne({ where: { name: safe } });
    if (!row) {
      throw new BadRequestException(`S3 profile "${safe}" not found.`);
    }
  }

  /**
   * Upload a local file to the bucket for a saved profile. `objectKey` is the full key (no leading slash).
   */
  async uploadLocalFile(
    profileName: string,
    localAbsolutePath: string,
    objectKey: string,
  ): Promise<{ bucket: string; key: string }> {
    const safeName = profileName?.trim();
    if (!safeName) {
      throw new BadRequestException('S3 profile name is required.');
    }
    const row = await this.profileRepo.findOne({ where: { name: safeName } });
    if (!row) {
      throw new NotFoundException(`S3 profile "${safeName}" not found`);
    }
    const input = rowToCredentials(row);
    const key = objectKey.replace(/^\/+/, '');
    if (!key) {
      throw new BadRequestException('Object key is required.');
    }
    const client = createS3Client(input);
    const resolvedPath = path.resolve(localAbsolutePath);
    try {
      await fs.access(resolvedPath);
      const st = await fs.stat(resolvedPath);
      if (!st.isFile()) {
        throw new BadRequestException(
          `S3 upload: path is not a file (${resolvedPath})`,
        );
      }
      if (st.size === 0) {
        throw new BadRequestException(
          `S3 upload: backup file is empty (0 bytes): ${resolvedPath}`,
        );
      }
      const contentType = key.endsWith('.gz')
        ? 'application/gzip'
        : 'application/octet-stream';
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: key,
          Body: createReadStream(resolvedPath),
          ContentType: contentType,
        }),
      );
      return { bucket: input.bucket, key };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 upload failed: ${getErrorMessage(e)} (file: ${resolvedPath})`,
      );
    } finally {
      client.destroy();
    }
  }
}
