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

  for (const p of await projectRepo.find({ where: { organizationId: IsNull() } })) {
    const oid = await resolveDefaultOrgId(ds, p.userId);
    if (oid == null) {
      log.warn(
        `Project ${p.id}: user ${p.userId} has no organization membership; assign an org manually.`,
      );
      continue;
    }
    p.organizationId = oid;
    await projectRepo.save(p);
  }

  for (const r of await rsRepo.find({ where: { organizationId: IsNull() } })) {
    const oid = await resolveDefaultOrgId(ds, r.userId);
    if (oid == null) {
      log.warn(
        `RemoteServer ${r.id}: user ${r.userId} has no organization membership; assign manually.`,
      );
      continue;
    }
    r.organizationId = oid;
    await rsRepo.save(r);
  }

  for (const row of await s3Repo.find({ where: { organizationId: IsNull() } })) {
    const oid = await resolveDefaultOrgId(ds, row.userId);
    if (oid == null) {
      log.warn(
        `S3Profile ${row.id}: user ${row.userId} has no organization membership; assign manually.`,
      );
      continue;
    }
    row.organizationId = oid;
    row.workspaceKey = `o:${oid}`;
    await s3Repo.save(row);
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
    if (oid == null) oid = await resolveDefaultOrgId(ds, ch.userId);
    if (oid == null) {
      log.warn(
        `NotificationChannel ${ch.id}: cannot resolve org; assign manually.`,
      );
      continue;
    }
    ch.organizationId = oid;
    await nchRepo.save(ch);
  }

  for (const job of await cronRepo.find({
    where: { organizationId: IsNull() },
  })) {
    let oid: number | null = null;
    const rs = await rsRepo.findOne({ where: { id: job.remoteServerId } });
    oid = rs?.organizationId ?? null;
    if (oid == null) oid = await resolveDefaultOrgId(ds, job.userId);
    if (oid == null) {
      log.warn(`CronJob ${job.id}: cannot resolve org; assign manually.`);
      continue;
    }
    job.organizationId = oid;
    await cronRepo.save(job);
  }

  for (const w of await whRepo.find({ where: { organizationId: IsNull() } })) {
    let oid: number | null = null;
    if (w.serviceId != null) {
      const svc = await svcRepo.findOne({
        where: { id: w.serviceId },
        relations: ['project'],
      });
      oid = svc?.project?.organizationId ?? null;
    }
    if (oid == null) oid = await resolveDefaultOrgId(ds, w.userId);
    if (oid == null) {
      log.warn(`Webhook ${w.id}: cannot resolve org; assign manually.`);
      continue;
    }
    w.organizationId = oid;
    await whRepo.save(w);
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
