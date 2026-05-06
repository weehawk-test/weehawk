import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const log = new Logger('RemoteServerProvisionJobOrgMigration');

async function tableExists(ds: DataSource, table: string): Promise<boolean> {
  const t = String(ds.options.type);
  try {
    if (t === 'postgres') {
      const rows = await ds.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = $1
        ) AS "exists"`,
        [table],
      );
      return Boolean(rows[0]?.exists);
    }
    if (t === 'sqlite') {
      const rows = await ds.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
        [table],
      );
      return Array.isArray(rows) && rows.length > 0;
    }
  } catch {
    return false;
  }
  return false;
}

async function listColumns(ds: DataSource, table: string): Promise<string[]> {
  const t = String(ds.options.type);
  if (t === 'postgres') {
    const rows = (await ds.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    )) as { column_name: string }[];
    return Array.isArray(rows) ? rows.map((r) => r.column_name) : [];
  }
  if (t === 'sqlite') {
    const rows = (await ds.query(
      `PRAGMA table_info(${table})`,
    )) as { name: string }[];
    return Array.isArray(rows) ? rows.map((r) => r.name) : [];
  }
  return [];
}

/**
 * Adds `organization_id` to provision job rows (from `remote_servers`) for org-scoped cleanup and auditing.
 */
export async function migrateRemoteServerProvisionJobsOrganizationId(
  ds: DataSource,
): Promise<void> {
  if (!(await tableExists(ds, 'remote_server_provision_jobs'))) {
    return;
  }

  const cols = await listColumns(ds, 'remote_server_provision_jobs');
  const dbType = String(ds.options.type);

  if (!cols.includes('organization_id')) {
    if (dbType === 'postgres') {
      await ds.query(
        `ALTER TABLE remote_server_provision_jobs ADD COLUMN IF NOT EXISTS organization_id int`,
      );
    } else if (dbType === 'sqlite') {
      await ds.query(
        `ALTER TABLE remote_server_provision_jobs ADD COLUMN organization_id integer`,
      );
    } else {
      log.warn(
        `remote_server_provision_jobs: unsupported DB "${dbType}" for organization_id.`,
      );
      return;
    }
  }

  try {
    if (dbType === 'postgres') {
      await ds.query(`
        UPDATE remote_server_provision_jobs j
        SET organization_id = rs.organization_id
        FROM remote_servers rs
        WHERE j.remote_server_id = rs.id
          AND (j.organization_id IS DISTINCT FROM rs.organization_id)
      `);
    } else if (dbType === 'sqlite') {
      await ds.query(`
        UPDATE remote_server_provision_jobs
        SET organization_id = (
          SELECT rs.organization_id FROM remote_servers rs
          WHERE rs.id = remote_server_provision_jobs.remote_server_id
        )
        WHERE EXISTS (
          SELECT 1 FROM remote_servers rs2
          WHERE rs2.id = remote_server_provision_jobs.remote_server_id
        )
      `);
    }
  } catch (e) {
    log.warn(
      `remote_server_provision_jobs organization_id backfill: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  log.log('remote_server_provision_jobs: organization_id column + backfill applied.');
}
