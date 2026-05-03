import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IsNull, Repository } from 'typeorm';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { resolveOrganizationInternalIdForMember } from '../common/organization-workspace-scope';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../organizations/organization-workspace-permissions';
import { UpsertS3ProfileDto } from './dto/upsert-s3-profile.dto';
import { TestS3ConnectionDto } from './dto/test-s3-connection.dto';
import { S3Profile } from './entities/s3-profile.entity';
import { RemoteServersService } from '../remote-servers/remote-servers.service';
import { inferS3ForcePathStyle } from './s3-force-path-style';
import {
  decryptPrivateKey,
  encryptPrivateKey,
} from '../remote-servers/ssh-key-crypto';
import { generatePublicId } from '../common/public-id';
import { RemoteServerTenantScopedRepository } from '../common/tenant-scoped.service';

const MAX_PROFILES = 50;

/** Legacy JSON storage path (migrated once on startup if DB is empty). */
function legacyProfilesFilePath(): string {
  return path.join(path.resolve(process.cwd(), 'storage'), 's3-profiles.json');
}

type PublicS3Profile = {
  publicId?: string;
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

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly scopedProfiles: RemoteServerTenantScopedRepository<S3Profile>;

  constructor(
    @InjectRepository(S3Profile)
    private readonly profileRepo: Repository<S3Profile>,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepo: Repository<OrganizationMembership>,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly configService: ConfigService,
    private readonly remoteServersService: RemoteServersService,
  ) {
    this.scopedProfiles = new RemoteServerTenantScopedRepository<S3Profile>(
      this.profileRepo,
      this.membershipRepo,
      'S3 profile',
    );
  }

  private async workspaceOrgId(
    userId: number,
    organizationPublicId?: string | null,
  ): Promise<number | null> {
    return resolveOrganizationInternalIdForMember(
      this.organizationsRepository,
      userId,
      organizationPublicId,
      { requireWorkspaceArea: ORGANIZATION_WORKSPACE_PERMISSIONS.S3 },
    );
  }

  private async resolveExpectedOrgId(
    userId: number,
    organizationPublicId?: string | null,
    organizationInternalId?: number | null,
  ): Promise<number | null> {
    if (organizationInternalId !== undefined) {
      return organizationInternalId;
    }
    return this.workspaceOrgId(userId, organizationPublicId);
  }

  private assertS3ProfileWorkspace(
    row: S3Profile,
    expectedOrgId: number | null,
  ): void {
    const rowOrg = row.organizationId ?? null;
    if (rowOrg !== expectedOrgId) {
      throw new NotFoundException('S3 profile not found');
    }
  }

  // SYSTEM-LEVEL BYPASS: Required for [startup migration without request user context].
  private async _internal_system_saveProfile(
    row: S3Profile,
  ): Promise<S3Profile> {
    return this.profileRepo.save(row);
  }

  async onModuleInit(): Promise<void> {
    await this.backfillS3WorkspaceKeys();
    await this.migrateFromLegacyJsonIfNeeded();
    await this.migrateExistingPlaintextSecrets();
  }

  private async backfillS3WorkspaceKeys(): Promise<void> {
    try {
      const rows = await this.profileRepo
        .createQueryBuilder('p')
        .where('p.workspace_key IS NULL OR p.workspace_key = :e', { e: '' })
        .getMany();
      for (const row of rows) {
        const org = row.organizationId ?? null;
        row.workspaceKey = org != null ? `o:${org}` : `u:${row.userId}`;
        await this._internal_system_saveProfile(row);
      }
    } catch {
      /* schema not ready */
    }
  }

  private async migrateExistingPlaintextSecrets(): Promise<void> {
    let key: string;
    try {
      key = this.getEncryptionSecret();
    } catch {
      return;
    }
    const rows = await this.profileRepo.find();
    const updates: S3Profile[] = [];
    for (const row of rows) {
      const raw = row.secretAccessKey?.trim();
      if (!raw) continue;
      try {
        decryptPrivateKey(raw, key);
      } catch {
        row.secretAccessKey = encryptPrivateKey(raw, key);
        updates.push(row);
      }
    }
    if (updates.length > 0) {
      for (const row of updates) {
        await this._internal_system_saveProfile(row);
      }
    }
  }

  private getEncryptionSecret(): string {
    const s = this.configService.get<string>('WEEHAWK_ENCRYPTION_KEY');
    if (!s || !String(s).trim()) {
      throw new ForbiddenException(
        'WEEHAWK_ENCRYPTION_KEY is required to read/write encrypted S3 credentials.',
      );
    }
    return String(s).trim();
  }

  private encryptSecretAccessKey(plaintext: string): string {
    return encryptPrivateKey(plaintext, this.getEncryptionSecret());
  }

  private decryptSecretAccessKey(value: string): string {
    if (!value?.trim()) return '';
    try {
      return decryptPrivateKey(value, this.getEncryptionSecret());
    } catch {
      // Backward compatibility with existing plaintext rows.
      return value;
    }
  }

  private rowToCredentials(row: S3Profile): NormalizedS3Credentials {
    return {
      name: row.name,
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: row.accessKeyId,
      secretAccessKey: this.decryptSecretAccessKey(row.secretAccessKey),
      forcePathStyle: row.forcePathStyle,
    };
  }

  /**
   * Resolve a saved profile by stable `publicId` (e.g. from URLs) or by human-readable `name` (UI / backup DTOs).
   */
  private async findProfileOrThrow(
    userId: number,
    identifier: string,
    organizationPublicId?: string | null,
    organizationInternalId?: number | null,
  ): Promise<S3Profile> {
    const safe = identifier?.trim();
    if (!safe)
      throw new BadRequestException('S3 profile identifier is required.');
    const expectedOrg = await this.resolveExpectedOrgId(
      userId,
      organizationPublicId,
      organizationInternalId,
    );
    try {
      const byPublicId = await this.scopedProfiles.findScopedBy(
        'publicId',
        safe,
        userId,
      );
      this.assertS3ProfileWorkspace(byPublicId, expectedOrg);
      return this.ensureProfilePublicId(byPublicId);
    } catch {
      const byName = await this.scopedProfiles.findScopedBy(
        'name',
        safe,
        userId,
      );
      this.assertS3ProfileWorkspace(byName, expectedOrg);
      return this.ensureProfilePublicId(byName);
    }
  }

  private async ensureProfilePublicId(row: S3Profile): Promise<S3Profile> {
    if (row.publicId?.trim()) return row;
    row.publicId = generatePublicId('s3');
    return this.scopedProfiles.saveScoped(row, row.userId);
  }

  private async findProfileByPublicIdOrThrow(
    userId: number,
    publicId: string,
    organizationPublicId?: string | null,
    organizationInternalId?: number | null,
  ): Promise<S3Profile> {
    const safe = publicId?.trim();
    if (!safe) throw new BadRequestException('S3 profile id is required.');
    const expectedOrg = await this.resolveExpectedOrgId(
      userId,
      organizationPublicId,
      organizationInternalId,
    );
    const row = await this.scopedProfiles.findScopedBy(
      'publicId',
      safe,
      userId,
    );
    this.assertS3ProfileWorkspace(row, expectedOrg);
    return this.ensureProfilePublicId(row);
  }

  private async findProfileByNameInWorkspace(
    userId: number,
    name: string,
    orgInternalId: number | null,
  ): Promise<S3Profile | null> {
    const safe = name?.trim();
    if (!safe) return null;
    if (orgInternalId != null) {
      return this.profileRepo.findOne({
        where: { name: safe, organizationId: orgInternalId },
      });
    }
    return this.profileRepo.findOne({
      where: { name: safe, userId, organizationId: IsNull() },
    });
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
      if (
        !name ||
        !endpoint ||
        !region ||
        !bucket ||
        !accessKeyId ||
        !secretAccessKey
      ) {
        continue;
      }
      const row = this.profileRepo.create({
        userId: 1,
        organizationId: null,
        workspaceKey: 'u:1',
        name,
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey: this.encryptSecretAccessKey(secretAccessKey),
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
    for (const row of rows) {
      // SYSTEM-LEVEL BYPASS: Required for [legacy JSON migration without authenticated user context].
      await this._internal_system_saveProfile(row);
    }
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

  private normalizeProfileFields(
    input: UpsertS3ProfileDto,
  ): Omit<NormalizedS3Credentials, 'secretAccessKey'> {
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

  private resolveSecretForSave(
    input: UpsertS3ProfileDto,
    existing: S3Profile | null,
  ): string {
    const trimmed = input.secretAccessKey?.trim() ?? '';
    if (trimmed) return trimmed;
    if (existing) return this.decryptSecretAccessKey(existing.secretAccessKey);
    throw new BadRequestException('secretAccessKey is required');
  }

  private normalizeProfile(input: UpsertS3ProfileDto): NormalizedS3Credentials {
    const base = this.normalizeProfileFields(input);
    const secretAccessKey = this.assertNonEmpty(
      input.secretAccessKey ?? '',
      'secretAccessKey',
    );
    return { ...base, secretAccessKey };
  }

  /** Short fixed-width mask for UI (does not scale with secret length). */
  private maskSecret(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 6) return '*'.repeat(secret.length);
    return `${secret.slice(0, 3)}••••••••${secret.slice(-3)}`;
  }

  private toPublicProfile(row: S3Profile): PublicS3Profile {
    const publicId = row.publicId?.trim();
    return {
      publicId: publicId ? publicId : undefined,
      name: row.name,
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: row.accessKeyId,
      forcePathStyle: row.forcePathStyle,
      createdAt: (row.createdAt ?? row.updatedAt).toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      secretAccessKeyMasked: this.maskSecret(
        this.decryptSecretAccessKey(row.secretAccessKey),
      ),
    };
  }

  async listProfiles(
    userId: number,
    organizationPublicId?: string | null,
  ) {
    const orgId = await this.workspaceOrgId(userId, organizationPublicId);
    const rows =
      orgId != null
        ? await this.scopedProfiles.listForOrganization(userId, orgId, {
            order: { updatedAt: 'DESC' },
            take: MAX_PROFILES,
          })
        : await this.scopedProfiles.listPersonal(userId, {
            order: { updatedAt: 'DESC' },
            take: MAX_PROFILES,
          });
    const rowsWithPublicId = await Promise.all(
      rows.map((p) => this.ensureProfilePublicId(p)),
    );
    return rowsWithPublicId.map((p) => this.toPublicProfile(p));
  }

  async saveProfile(userId: number, dto: UpsertS3ProfileDto) {
    const orgId = await this.workspaceOrgId(userId, dto.organizationPublicId);
    const base = this.normalizeProfileFields(dto);
    let row: S3Profile | null = await this.findProfileByNameInWorkspace(
      userId,
      base.name,
      orgId,
    );
    const secretAccessKey = this.resolveSecretForSave(dto, row);
    const n: NormalizedS3Credentials = { ...base, secretAccessKey };
    if (row) {
      row.endpoint = n.endpoint;
      row.region = n.region;
      row.bucket = n.bucket;
      row.accessKeyId = n.accessKeyId;
      row.secretAccessKey = this.encryptSecretAccessKey(n.secretAccessKey);
      row.forcePathStyle = n.forcePathStyle;
    } else {
      row = this.profileRepo.create({
        userId,
        organizationId: orgId,
        name: n.name,
        endpoint: n.endpoint,
        region: n.region,
        bucket: n.bucket,
        accessKeyId: n.accessKeyId,
        secretAccessKey: this.encryptSecretAccessKey(n.secretAccessKey),
        forcePathStyle: n.forcePathStyle,
      });
    }
    await this.scopedProfiles.saveScoped(row, userId);

    const all =
      orgId != null
        ? await this.profileRepo.find({
            where: { organizationId: orgId },
            order: { updatedAt: 'DESC' },
          })
        : await this.profileRepo.find({
            where: { userId, organizationId: IsNull() },
            order: { updatedAt: 'DESC' },
          });
    if (all.length > MAX_PROFILES) {
      await this.profileRepo.remove(all.slice(MAX_PROFILES));
    }

    const saved =
      (await this.findProfileByNameInWorkspace(userId, n.name, orgId)) ??
      row;
    const ensured = await this.ensureProfilePublicId(saved);
    return {
      success: true,
      profile: this.toPublicProfile(ensured),
    };
  }

  async deleteProfile(
    userId: number,
    publicId: string,
    organizationPublicId?: string | null,
  ) {
    const row = await this.findProfileByPublicIdOrThrow(
      userId,
      publicId,
      organizationPublicId,
    );
    await this.scopedProfiles.deleteScoped(row.id, userId);
    return { success: true, publicId: row.publicId };
  }

  async testConnection(
    userId: number,
    dto: TestS3ConnectionDto,
  ): Promise<{
    success: true;
    message: string;
    remoteServerId: number;
  }> {
    const input = this.normalizeProfile(dto);
    const remoteId = dto.remoteServerId;

    const { name: remoteName } =
      await this.remoteServersService.assertDeployServerById(remoteId, userId);

    const client = createS3Client(input);
    let listUrl: string;
    try {
      const cmd = new ListObjectsV2Command({
        Bucket: input.bucket,
        MaxKeys: 1,
      });
      listUrl = await (
        getSignedUrl as (
          c: unknown,
          command: unknown,
          opts: { expiresIn: number },
        ) => Promise<string>
      )(client, cmd, { expiresIn: 300 });
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `S3 remote test presign failed for profile "${input.name}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }

    try {
      await this.remoteServersService.curlPresignedProbeOnRemote(
        remoteId,
        userId,
        listUrl,
      );
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `S3 remote probe failed from deploy host "${remoteName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException('Storage service error');
    }

    return {
      success: true,
      message: `S3 connection verified from deploy host "${remoteName}"`,
      remoteServerId: remoteId,
    };
  }

  async assertProfileExists(
    identifier: string,
    userId: number,
    organizationInternalId: number | null,
  ): Promise<void> {
    const safe = identifier?.trim();
    if (!safe) {
      throw new BadRequestException('S3 profile name is required.');
    }
    try {
      await this.findProfileOrThrow(
        userId,
        safe,
        undefined,
        organizationInternalId,
      );
      return;
    } catch {
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
    organizationPublicId?: string | null,
  ): Promise<{
    bucket: string;
    prefix: string;
    folders: { prefix: string; name: string }[];
    objects: {
      key: string;
      name: string;
      size: number;
      lastModified: string;
    }[];
    isTruncated: boolean;
    continuationToken?: string;
  }> {
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
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
          const rel = normalizedPrefix
            ? key.slice(normalizedPrefix.length)
            : key;
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
      this.logger.error(
        `S3 list failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }
  }

  async deleteObject(
    userId: number,
    profileName: string,
    objectKey: string,
    organizationPublicId?: string | null,
  ): Promise<{ success: boolean; key: string }> {
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
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
      this.logger.error(
        `S3 delete failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
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
    organizationPublicId?: string | null,
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
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
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
      this.logger.error(
        `S3 batch delete failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * Normalize a folder prefix (must be non-empty; always ends with `/`).
   */
  private normalizeFolderPrefix(raw: string): string {
    const p = raw.replace(/^\/+/, '').trim();
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
    organizationPublicId?: string | null,
  ): Promise<{
    objectCount: number;
    totalSize: number;
    lastModified: string | null;
    isPartialSummary: boolean;
  }> {
    const PREFIX_SUMMARY_MAX_PAGES = 200;
    const prefix = this.normalizeFolderPrefix(prefixRaw);
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
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
      this.logger.error(
        `S3 prefix summary failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
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
    organizationPublicId?: string | null,
  ): Promise<{
    deletedCount: number;
    errors: { key: string; message: string }[];
  }> {
    const MAX_LIST = 1_000_000;
    const prefix = this.normalizeFolderPrefix(prefixRaw);
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
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
      this.logger.error(
        `S3 prefix delete failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
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
    organizationPublicId?: string | null,
  ): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: number;
    filename: string;
  }> {
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const client = createS3Client(input);
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: key }),
      );
      const body = response.Body;
      if (!body) {
        client.destroy();
        throw new InternalServerErrorException('Storage service error');
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
      this.logger.error(
        `S3 download stream failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    }
  }

  async uploadLocalFile(
    userId: number,
    profileName: string,
    localAbsolutePath: string,
    objectKey: string,
    organizationPublicId?: string | null,
  ): Promise<{ bucket: string; key: string }> {
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
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
      this.logger.error(
        `S3 upload failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException('Storage service error');
    } finally {
      client.destroy();
    }
  }

  /**
   * Upload from the browser through the API (avoids presigned PUT + CORS / internal MinIO URLs).
   * Request body is buffered in API memory; limit {@link S3Service.S3_UPLOAD_VIA_API_MAX_BYTES}.
   */
  static readonly S3_UPLOAD_VIA_API_MAX_BYTES = 512 * 1024 * 1024;

  async putObjectBuffer(
    userId: number,
    profileName: string,
    objectKey: string,
    body: Buffer,
    contentType: string,
    organizationPublicId?: string | null,
  ): Promise<{ bucket: string; key: string }> {
    const maxBytes = S3Service.S3_UPLOAD_VIA_API_MAX_BYTES;
    const buf = body ?? Buffer.alloc(0);
    if (buf.length > maxBytes) {
      throw new BadRequestException(
        `Upload exceeds maximum size (${Math.floor(maxBytes / (1024 * 1024))} MiB).`,
      );
    }
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const ct =
      contentType?.trim() ||
      (key.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream');
    const client = createS3Client(input);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: key,
          Body: buf,
          ContentType: ct,
        }),
      );
      return { bucket: input.bucket, key };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `S3 buffer upload failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * Create a “folder” in S3 (zero-byte object whose key ends with `/`).
   */
  async putFolderMarker(
    userId: number,
    profileName: string,
    objectKey: string,
    organizationPublicId?: string | null,
  ): Promise<{ bucket: string; key: string }> {
    let key = this.assertSafeObjectKey(objectKey);
    if (!key.endsWith('/')) {
      key = `${key}/`;
    }
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
    const client = createS3Client(input);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: key,
          Body: new Uint8Array(0),
          ContentType: 'application/x-directory',
        }),
      );
      return { bucket: input.bucket, key };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `S3 folder marker failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * Download an object to a local file path (writes the full object, then returns).
   */
  /** Presigned PUT so clients or deploy hosts upload bytes directly to the bucket (not via API disk). */
  async presignPutObject(
    userId: number,
    profileName: string,
    objectKey: string,
    opts?: {
      contentType?: string;
      expiresInSeconds?: number;
      organizationPublicId?: string | null;
      organizationInternalId?: number | null;
    },
  ): Promise<{
    url: string;
    bucket: string;
    key: string;
    expiresIn: number;
    contentType: string;
  }> {
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      opts?.organizationPublicId,
      opts?.organizationInternalId,
    );
    const input = this.rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const expiresIn = Math.min(
      Math.max(opts?.expiresInSeconds ?? 3600, 60),
      60 * 60 * 24 * 7,
    );
    const contentType =
      opts?.contentType?.trim() ||
      (key.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream');
    const client = createS3Client(input);
    try {
      const cmd = new PutObjectCommand({
        Bucket: input.bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await (
        getSignedUrl as (
          c: unknown,
          command: unknown,
          opts: { expiresIn: number },
        ) => Promise<string>
      )(client, cmd, { expiresIn });
      return { url, bucket: input.bucket, key, expiresIn, contentType };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `S3 presigned PUT failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }
  }

  /** Presigned GET so clients download directly from the bucket (not streamed through the API). */
  async presignGetObject(
    userId: number,
    profileName: string,
    objectKey: string,
    expiresInSeconds?: number,
    organizationPublicId?: string | null,
    organizationInternalId?: number | null,
  ): Promise<{ url: string; bucket: string; key: string; expiresIn: number }> {
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
      organizationInternalId,
    );
    const input = this.rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const expiresIn = Math.min(
      Math.max(expiresInSeconds ?? 3600, 60),
      60 * 60 * 24 * 7,
    );
    const client = createS3Client(input);
    try {
      const cmd = new GetObjectCommand({ Bucket: input.bucket, Key: key });
      const url = await (
        getSignedUrl as (
          c: unknown,
          command: unknown,
          opts: { expiresIn: number },
        ) => Promise<string>
      )(client, cmd, { expiresIn });
      return { url, bucket: input.bucket, key, expiresIn };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `S3 presigned GET failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }
  }

  async downloadObjectToFile(
    userId: number,
    profileName: string,
    objectKey: string,
    destAbsolutePath: string,
    organizationPublicId?: string | null,
  ): Promise<void> {
    const row = await this.findProfileOrThrow(
      userId,
      profileName,
      organizationPublicId,
    );
    const input = this.rowToCredentials(row);
    const key = this.assertSafeObjectKey(objectKey);
    const resolvedPath = path.resolve(destAbsolutePath);
    const client = createS3Client(input);
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: key }),
      );
      const body = response.Body;
      if (!body) {
        throw new InternalServerErrorException('Storage service error');
      }
      const rs = body as Readable;
      await pipeline(rs, createWriteStream(resolvedPath));
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      this.logger.error(
        `S3 download-to-file failed for profile "${profileName}"`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new InternalServerErrorException(
        'Storage service error',
      );
    } finally {
      client.destroy();
    }
  }
}
