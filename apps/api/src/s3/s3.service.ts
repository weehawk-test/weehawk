import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
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

  private async findProfileOrThrow(userId: number, name: string): Promise<S3Profile> {
    const safe = name?.trim();
    if (!safe) throw new BadRequestException('S3 profile name is required.');
    const row = await this.profileRepo.findOne({ where: { userId, name: safe } });
    if (!row) throw new NotFoundException(`S3 profile "${safe}" not found`);
    return row;
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

  async listProfiles(userId: number) {
    const rows = await this.profileRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: MAX_PROFILES,
    });
    return rows.map((p) => this.toPublicProfile(p));
  }

  async saveProfile(userId: number, dto: UpsertS3ProfileDto) {
    const base = this.normalizeProfileFields(dto);
    let row = await this.profileRepo.findOne({ where: { userId, name: base.name } });
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
        userId,
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

    const all = await this.profileRepo.find({ where: { userId }, order: { updatedAt: 'DESC' } });
    if (all.length > MAX_PROFILES) {
      await this.profileRepo.remove(all.slice(MAX_PROFILES));
    }

    const saved = await this.profileRepo.findOne({ where: { userId, name: n.name } });
    if (!saved) {
      throw new InternalServerErrorException('Failed to persist S3 profile');
    }
    return {
      success: true,
      profile: this.toPublicProfile(saved),
    };
  }

  async deleteProfile(userId: number, name: string) {
    const safeName = this.assertNonEmpty(name, 'name');
    await this.profileRepo.delete({ userId, name: safeName });
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
        message: 'S3 connection verified',
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

  async assertProfileExists(name: string, userId?: number): Promise<void> {
    const safe = name?.trim();
    if (!safe) {
      throw new BadRequestException('S3 profile name is required.');
    }
    const row = await this.profileRepo.findOne({ where: userId != null ? { userId, name: safe } : { name: safe } });
    if (!row) {
      throw new BadRequestException(`S3 profile "${safe}" not found.`);
    }
  }

  /**
   * Upload a local file to the bucket for a saved profile. `objectKey` is the full key (no leading slash).
   */
  private assertSafeObjectKey(objectKey: string): string {
    const key = objectKey.replace(/^\/+/, '').trim();
    if (!key) {
      throw new BadRequestException('Object key is required.');
    }
    if (key.includes('..') || key.includes('\\')) {
      throw new BadRequestException('Invalid object key.');
    }
    return key;
  }

  private normalizeListPrefix(raw: string | undefined): string {
    const t = raw?.trim() ?? '';
    if (!t) return '';
    let p = t.replace(/^\/+/, '');
    if (!p.endsWith('/')) p += '/';
    return p;
  }

  /**
   * List “folders” (common prefixes) and objects at one level under `prefix` (virtual directories via delimiter).
   */
  async listBucketObjects(
    userId: number,
    profileName: string,
    prefixRaw: string | undefined,
    continuationToken: string | undefined,
  ): Promise<{
    bucket: string;
    prefix: string;
    folders: { prefix: string; name: string }[];
    objects: { key: string; name: string; size: number; lastModified: string }[];
    isTruncated: boolean;
    continuationToken?: string;
  }> {
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const normalizedPrefix = this.normalizeListPrefix(prefixRaw);
    const client = createS3Client(input);
    try {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: normalizedPrefix,
          Delimiter: '/',
          MaxKeys: 500,
          ContinuationToken: continuationToken,
        }),
      );

      const folders = (result.CommonPrefixes ?? []).map((cp) => {
        const p = cp.Prefix ?? '';
        const trimmed = p.replace(/\/$/, '');
        const name = trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed;
        return { prefix: p, name };
      });

      const objects = (result.Contents ?? [])
        .map((c) => {
          const key = c.Key;
          if (!key || key.endsWith('/')) return null;
          const rel = normalizedPrefix ? key.slice(normalizedPrefix.length) : key;
          if (rel.includes('/')) return null;
          return {
            key,
            name: rel,
            size: c.Size ?? 0,
            lastModified: c.LastModified?.toISOString() ?? '',
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return {
        bucket: input.bucket,
        prefix: normalizedPrefix,
        folders,
        objects,
        isTruncated: Boolean(result.IsTruncated),
        continuationToken: result.NextContinuationToken,
      };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 list failed: ${getErrorMessage(e)}`,
      );
    } finally {
      client.destroy();
    }
  }

  async deleteObject(
    userId: number,
    profileName: string,
    objectKey: string,
  ): Promise<{ success: boolean; key: string }> {
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const client = createS3Client(input);
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: input.bucket, Key: key }),
      );
      return { success: true, key };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 delete failed: ${getErrorMessage(e)}`,
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete up to 1000 objects in one S3 DeleteObjects call.
   */
  async deleteObjectsBatch(
    userId: number,
    profileName: string,
    keys: string[],
  ): Promise<{
    deleted: string[];
    errors: { key: string; message: string }[];
  }> {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new BadRequestException('keys must be a non-empty array.');
    }
    if (keys.length > 1000) {
      throw new BadRequestException('At most 1000 keys per batch.');
    }
    const sanitized: string[] = [];
    const seen = new Set<string>();
    for (const raw of keys) {
      const k = this.assertSafeObjectKey(String(raw));
      if (!seen.has(k)) {
        seen.add(k);
        sanitized.push(k);
      }
    }
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const client = createS3Client(input);
    try {
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: input.bucket,
          Delete: {
            Objects: sanitized.map((Key) => ({ Key })),
            Quiet: false,
          },
        }),
      );
      const deleted = (result.Deleted ?? [])
        .map((d) => d.Key)
        .filter((k): k is string => Boolean(k));
      const errors = (result.Errors ?? []).map((e) => ({
        key: e.Key ?? '',
        message: e.Message ?? 'Unknown error',
      }));
      return { deleted, errors };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 batch delete failed: ${getErrorMessage(e)}`,
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * Normalize a folder prefix (must be non-empty; always ends with `/`).
   */
  private normalizeFolderPrefix(raw: string): string {
    let p = raw.replace(/^\/+/, '').trim();
    if (!p) {
      throw new BadRequestException('prefix is required.');
    }
    if (p.includes('..') || p.includes('\\')) {
      throw new BadRequestException('Invalid prefix.');
    }
    return p.endsWith('/') ? p : `${p}/`;
  }

  /**
   * Aggregate size, count, and latest LastModified for all objects under a prefix (recursive).
   * Stops after PREFIX_SUMMARY_MAX_PAGES pages; sets isPartialSummary if more keys remain.
   */
  async summarizePrefix(
    userId: number,
    profileName: string,
    prefixRaw: string,
  ): Promise<{
    objectCount: number;
    totalSize: number;
    lastModified: string | null;
    isPartialSummary: boolean;
  }> {
    const PREFIX_SUMMARY_MAX_PAGES = 200;
    const prefix = this.normalizeFolderPrefix(prefixRaw);
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const client = createS3Client(input);
    let objectCount = 0;
    let totalSize = 0;
    let lastModified: Date | null = null;
    let continuationToken: string | undefined;
    try {
      for (let page = 0; page < PREFIX_SUMMARY_MAX_PAGES; page++) {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          }),
        );
        for (const c of result.Contents ?? []) {
          const k = c.Key;
          if (!k) continue;
          objectCount++;
          totalSize += c.Size ?? 0;
          const lm = c.LastModified;
          if (lm && (!lastModified || lm > lastModified)) {
            lastModified = lm;
          }
        }
        if (!result.IsTruncated || !result.NextContinuationToken) {
          continuationToken = undefined;
          break;
        }
        continuationToken = result.NextContinuationToken;
      }
      const isPartialSummary = Boolean(continuationToken);
      return {
        objectCount,
        totalSize,
        lastModified: lastModified?.toISOString() ?? null,
        isPartialSummary,
      };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 prefix summary failed: ${getErrorMessage(e)}`,
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * List and delete every object whose key starts with `prefix` (recursive). Streams in batches to limit memory.
   */
  async deleteObjectsUnderPrefix(
    userId: number,
    profileName: string,
    prefixRaw: string,
  ): Promise<{
    deletedCount: number;
    errors: { key: string; message: string }[];
  }> {
    const MAX_LIST = 1_000_000;
    const prefix = this.normalizeFolderPrefix(prefixRaw);
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const client = createS3Client(input);
    const errors: { key: string; message: string }[] = [];
    let deletedCount = 0;
    let totalListed = 0;
    const pending: string[] = [];
    let continuationToken: string | undefined;

    const flushDelete = async (keys: string[]) => {
      if (keys.length === 0) return;
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: input.bucket,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: false,
          },
        }),
      );
      deletedCount += (result.Deleted ?? []).filter((d) => d.Key).length;
      for (const e of result.Errors ?? []) {
        errors.push({
          key: e.Key ?? '',
          message: e.Message ?? 'Unknown error',
        });
      }
    };

    try {
      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          }),
        );
        for (const c of result.Contents ?? []) {
          const k = c.Key;
          if (!k) continue;
          totalListed++;
          if (totalListed > MAX_LIST) {
            throw new BadRequestException(
              `Too many objects under this prefix (limit ${MAX_LIST}). Split the workload or use another tool.`,
            );
          }
          pending.push(k);
          if (pending.length >= 1000) {
            await flushDelete(pending.splice(0, 1000));
          }
        }
        continuationToken = result.IsTruncated
          ? result.NextContinuationToken
          : undefined;
      } while (continuationToken);
      while (pending.length > 0) {
        await flushDelete(pending.splice(0, 1000));
      }
      return { deletedCount, errors };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 prefix delete failed: ${getErrorMessage(e)}`,
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * Stream object bytes for download (caller must consume the stream; client is destroyed when the stream ends or errors).
   */
  async getObjectStream(
    userId: number,
    profileName: string,
    objectKey: string,
  ): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: number;
    filename: string;
  }> {
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const client = createS3Client(input);
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: key }),
      );
      const body = response.Body;
      if (!body) {
        client.destroy();
        throw new InternalServerErrorException('Empty S3 object body.');
      }
      const stream = body as Readable;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        client.destroy();
      };
      stream.once('end', cleanup);
      stream.once('error', cleanup);
      stream.once('close', cleanup);
      const filename = path.basename(key) || 'download';
      return {
        stream,
        contentType: response.ContentType ?? 'application/octet-stream',
        contentLength: response.ContentLength,
        filename,
      };
    } catch (e) {
      client.destroy();
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 download failed: ${getErrorMessage(e)}`,
      );
    }
  }

  async uploadLocalFile(
    userId: number,
    profileName: string,
    localAbsolutePath: string,
    objectKey: string,
  ): Promise<{ bucket: string; key: string }> {
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
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

  /**
   * Download an object to a local file path (writes the full object, then returns).
   */
  async downloadObjectToFile(
    userId: number,
    profileName: string,
    objectKey: string,
    destAbsolutePath: string,
  ): Promise<void> {
    const row = await this.findProfileOrThrow(userId, profileName);
    const input = rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const resolvedPath = path.resolve(destAbsolutePath);
    const client = createS3Client(input);
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: key }),
      );
      const body = response.Body;
      if (!body) {
        throw new InternalServerErrorException('Empty S3 object body.');
      }
      const rs = body as Readable;
      await pipeline(rs, createWriteStream(resolvedPath));
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `S3 download failed: ${getErrorMessage(e)}`,
      );
    } finally {
      client.destroy();
    }
  }
}
