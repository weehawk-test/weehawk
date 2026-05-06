import { Logger } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { DataSource } from 'typeorm';
import { CronJob } from '../cron-jobs/entities/cron-job.entity';
import { NotificationChannel } from '../notifications/entities/notification-channel.entity';
import { Project } from '../projects/entities/project.entity';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { RemoteServer } from '../remote-servers/entities/remote-server.entity';
import { S3Profile } from '../s3/entities/s3-profile.entity';
import { Service } from '../services/entities/service.entity';
import { Webhook } from '../webhooks/entities/webhook.entity';

const log = new Logger('OrgScopeBackfill');

/**
 * Backfill queries assume tables already exist. On a fresh DB, TypeORM has not run `synchronize` yet
 * (the pre-pass in `app.module` uses `synchronize: false`), so skip until schema exists.
 */
async function schemaHasProjectsTable(ds: DataSource): Promise<boolean> {
  const type = ds.options.type;
  try {
    if (type === 'postgres') {
      const rows = await ds.query<{ exists: number }>(
        `SELECT 1 AS "exists" FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = 'projects' LIMIT 1`,
      );
      return Array.isArray(rows) && rows.length > 0;
    }
    if (type === 'sqlite') {
      const rows = await ds.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects' LIMIT 1`,
      );
      return Array.isArray(rows) && rows.length > 0;
    }
    await ds.query('SELECT 1 FROM projects LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultOrgId(
  ds: DataSource,
  userId: number,
): Promise<number | null> {
  const m = await ds.getRepository(OrganizationMembership).findOne({
    where: { userId },
    order: { createdAt: 'ASC' },
  });
  return m?.organizationId ?? null;
}

/** Backfill may run before `projects.user_id` is dropped; use SQL so legacy column is still readable. */
async function loadProjectsMissingOrgWithLegacyUserId(
  ds: DataSource,
): Promise<Array<{ id: number; userId: number }>> {
  const type = ds.options.type;
  try {
    if (type === 'postgres' || type === 'sqlite') {
      const rows = (await ds.query(
        `SELECT id, user_id FROM projects WHERE organization_id IS NULL`,
      )) as Array<{ id: number; user_id: string | number }>;
      return (Array.isArray(rows) ? rows : []).map((r) => ({
        id: Number(r.id),
        userId: Number(r.user_id),
      }));
    }
  } catch (e) {
    log.warn(
      `Could not read legacy projects.user_id for org backfill: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return [];
}

/** Backfill may run before `remote_servers.user_id` is dropped; use SQL so legacy column is still readable. */
async function loadRemoteServersMissingOrgWithLegacyUserId(
  ds: DataSource,
): Promise<Array<{ id: number; userId: number }>> {
  try {
    const rows = (await ds.query(
      `SELECT id, user_id FROM remote_servers WHERE organization_id IS NULL`,
    )) as Array<{ id: number; user_id: string | number }>;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
    }));
  } catch (e) {
    log.warn(
      `Could not read legacy remote_servers.user_id for org backfill: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return [];
}

/** Backfill may run before `s3_profiles.user_id` is dropped; use SQL so legacy column is still readable. */
async function loadS3ProfilesMissingOrgWithLegacyUserId(
  ds: DataSource,
): Promise<Array<{ id: number; userId: number }>> {
  try {
    const rows = (await ds.query(
      `SELECT id, user_id FROM s3_profiles WHERE organization_id IS NULL`,
    )) as Array<{ id: number; user_id: string | number }>;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
    }));
  } catch (e) {
    log.warn(
      `Could not read legacy s3_profiles.user_id for org backfill: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return [];
}

/** Backfill may run before `webhooks.user_id` is dropped; use SQL so legacy column is still readable. */
async function loadWebhooksMissingOrgWithLegacyUserId(
  ds: DataSource,
): Promise<Array<{ id: number; userId: number }>> {
  try {
    const rows = (await ds.query(
      `SELECT id, user_id FROM webhooks WHERE organization_id IS NULL`,
    )) as Array<{ id: number; user_id: string | number }>;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
    }));
  } catch (e) {
    log.warn(
      `Could not read legacy webhooks.user_id for org backfill: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return [];
}

/**
 * Migrates legacy rows with NULL `organization_id` before NOT NULL constraints.
 * Safe to run on every startup (no-ops when nothing left to fix).
 */
export async function runOrgScopeSchemaBackfill(ds: DataSource): Promise<void> {
  if (!(await schemaHasProjectsTable(ds))) {
    log.log(
      'Org-scope backfill: skipped (projects table not present yet; first sync will create schema).',
    );
    return;
  }

  const projectRepo = ds.getRepository(Project);
  const rsRepo = ds.getRepository(RemoteServer);
  const s3Repo = ds.getRepository(S3Profile);
  const whRepo = ds.getRepository(Webhook);
  const cronRepo = ds.getRepository(CronJob);
  const nchRepo = ds.getRepository(NotificationChannel);
  const svcRepo = ds.getRepository(Service);

  for (const p of await loadProjectsMissingOrgWithLegacyUserId(ds)) {
    const oid = await resolveDefaultOrgId(ds, p.userId);
    if (oid == null) {
      log.warn(
        `Project ${p.id}: user ${p.userId} has no organization membership; assign an org manually.`,
      );
      continue;
    }
    const row = await projectRepo.findOne({ where: { id: p.id } });
    if (!row) continue;
    row.organizationId = oid;
    await projectRepo.save(row);
  }

  for (const r of await loadRemoteServersMissingOrgWithLegacyUserId(ds)) {
    const oid = await resolveDefaultOrgId(ds, r.userId);
    if (oid == null) {
      log.warn(
        `RemoteServer ${r.id}: user ${r.userId} has no organization membership; assign manually.`,
      );
      continue;
    }
    const row = await rsRepo.findOne({ where: { id: r.id } });
    if (!row) continue;
    row.organizationId = oid;
    await rsRepo.save(row);
  }

  for (const row of await loadS3ProfilesMissingOrgWithLegacyUserId(ds)) {
    const oid = await resolveDefaultOrgId(ds, row.userId);
    if (oid == null) {
      log.warn(
        `S3Profile ${row.id}: user ${row.userId} has no organization membership; assign manually.`,
      );
      continue;
    }
    const s3Row = await s3Repo.findOne({ where: { id: row.id } });
    if (!s3Row) continue;
    s3Row.organizationId = oid;
    s3Row.workspaceKey = `o:${oid}`;
    await s3Repo.save(s3Row);
  }

  for (const ch of await nchRepo.find({
    where: { organizationId: IsNull() },
  })) {
    let oid: number | null = null;
    if (ch.remoteServerId != null) {
      const rs = await rsRepo.findOne({
        where: { id: ch.remoteServerId },
      });
      oid = rs?.organizationId ?? null;
    }
    if (oid == null) {
      log.warn(
        `NotificationChannel ${ch.id}: cannot resolve org from remote server; assign manually.`,
      );
      continue;
    }
    ch.organizationId = oid;
    await nchRepo.save(ch);
  }

  for (const job of await cronRepo.find({
    where: { organizationId: IsNull() },
  })) {
    const rs = await rsRepo.findOne({ where: { id: job.remoteServerId } });
    const oid = rs?.organizationId ?? null;
    if (oid == null) {
      log.warn(
        `CronJob ${job.id}: cannot resolve org from remote server; assign manually.`,
      );
      continue;
    }
    job.organizationId = oid;
    await cronRepo.save(job);
  }

  for (const w of await loadWebhooksMissingOrgWithLegacyUserId(ds)) {
    let oid: number | null = null;
    const whRow = await whRepo.findOne({ where: { id: w.id } });
    if (!whRow) continue;
    if (whRow.serviceId != null) {
      const svc = await svcRepo.findOne({
        where: { id: whRow.serviceId },
        relations: ['project'],
      });
      oid = svc?.project?.organizationId ?? null;
    }
    if (oid == null) oid = await resolveDefaultOrgId(ds, w.userId);
    if (oid == null) {
      log.warn(`Webhook ${w.id}: cannot resolve org; assign manually.`);
      continue;
    }
    whRow.organizationId = oid;
    await whRepo.save(whRow);
  }

  for (const row of await s3Repo.find()) {
    if (row.organizationId == null) continue;
    const expected = `o:${row.organizationId}`;
    if (row.workspaceKey !== expected) {
      row.workspaceKey = expected;
      await s3Repo.save(row);
    }
  }

  const remain =
    (await projectRepo.count({ where: { organizationId: IsNull() } })) +
    (await rsRepo.count({ where: { organizationId: IsNull() } })) +
    (await s3Repo.count({ where: { organizationId: IsNull() } })) +
    (await whRepo.count({ where: { organizationId: IsNull() } })) +
    (await cronRepo.count({ where: { organizationId: IsNull() } })) +
    (await nchRepo.count({ where: { organizationId: IsNull() } }));

  if (remain > 0) {
    log.warn(
      `${remain} row(s) still have NULL organization_id after backfill. Fix memberships or data before enforcing NOT NULL.`,
    );
  } else {
    log.log('Org-scope backfill: all workspace rows have organization_id set.');
  }
}
