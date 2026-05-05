import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const log = new Logger('AuditLogTargetEmail');

async function auditLogTableExists(ds: DataSource): Promise<boolean> {
  const type = ds.options.type;
  try {
    if (type === 'postgres') {
      const rows = await ds.query<{ exists: number }>(
        `SELECT 1 AS "exists" FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = 'organization_audit_logs' LIMIT 1`,
      );
      return Array.isArray(rows) && rows.length > 0;
    }
    if (type === 'sqlite') {
      const rows = await ds.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organization_audit_logs' LIMIT 1`,
      );
      return Array.isArray(rows) && rows.length > 0;
    }
    if (type === 'mysql' || type === 'mariadb') {
      const rows = await ds.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_audit_logs' LIMIT 1`,
      );
      return Array.isArray(rows) && rows.length > 0;
    }
  } catch {
    return false;
  }
  return false;
}

async function targetEmailColumnExists(ds: DataSource): Promise<boolean> {
  const type = ds.options.type;
  if (type === 'postgres') {
    const rows = await ds.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'organization_audit_logs'
         AND column_name = 'target_email' LIMIT 1`,
    );
    return Array.isArray(rows) && rows.length > 0;
  }
  if (type === 'sqlite') {
    const rows = await ds.query<{ name: string }>(
      `PRAGMA table_info(organization_audit_logs)`,
    );
    return (
      Array.isArray(rows) && rows.some((r) => r.name === 'target_email')
    );
  }
  if (type === 'mysql' || type === 'mariadb') {
    const rows = await ds.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'organization_audit_logs'
         AND COLUMN_NAME = 'target_email' LIMIT 1`,
    );
    return Array.isArray(rows) && rows.length > 0;
  }
  return false;
}

/**
 * Moves legacy `target_email` into `metadata.targetEmail`, then drops the column.
 * Runs on the pre-sync DataSource (synchronize: false) so schema still has the column.
 */
export async function migrateOrganizationAuditLogTargetEmailToMetadata(
  ds: DataSource,
): Promise<void> {
  if (!(await auditLogTableExists(ds))) {
    return;
  }
  if (!(await targetEmailColumnExists(ds))) {
    return;
  }

  log.log(
    'Migrating organization_audit_logs.target_email into metadata; dropping column.',
  );

  const type = ds.options.type;
  const rows = (await ds.query(
    `SELECT id, target_email AS "target_email", metadata FROM organization_audit_logs
     WHERE target_email IS NOT NULL AND length(trim(target_email)) > 0`,
  )) as Array<{ id: number; target_email: string; metadata: string | null }>;

  for (const row of Array.isArray(rows) ? rows : []) {
    let meta: Record<string, unknown> = {};
    if (row.metadata != null && String(row.metadata).trim() !== '') {
      try {
        const parsed = JSON.parse(String(row.metadata)) as unknown;
        if (
          parsed != null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = {};
      }
    }
    const te = String(row.target_email).trim().toLowerCase();
    if (
      te &&
      (meta.targetEmail == null || String(meta.targetEmail).trim() === '')
    ) {
      meta = { ...meta, targetEmail: te };
    }
    const payload = JSON.stringify(meta);
    if (type === 'postgres') {
      await ds.query(
        `UPDATE organization_audit_logs SET metadata = $1 WHERE id = $2`,
        [payload, row.id],
      );
    } else {
      await ds.query(
        `UPDATE organization_audit_logs SET metadata = ? WHERE id = ?`,
        [payload, row.id],
      );
    }
  }

  if (type === 'postgres' || type === 'mysql' || type === 'mariadb') {
    await ds.query(
      `ALTER TABLE organization_audit_logs DROP COLUMN target_email`,
    );
  } else if (type === 'sqlite') {
    try {
      await ds.query(
        `ALTER TABLE organization_audit_logs DROP COLUMN target_email`,
      );
    } catch (e) {
      log.warn(
        `Could not DROP target_email on SQLite (need 3.35+). Remove column manually or upgrade SQLite. ${String(e)}`,
      );
    }
  }
}
