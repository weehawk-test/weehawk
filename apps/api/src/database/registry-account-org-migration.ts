import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';

const log = new Logger('RegistryAccountOrgMigration');

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

function qIdent(raw: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) {
    throw new Error(`Unsafe SQL identifier: ${raw}`);
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function pickUserId(row: Record<string, unknown>): number | null {
  const v = row.user_id ?? row.userId;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return null;
}

function pickId(row: Record<string, unknown>): number | null {
  const v = row.id;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickOrgId(row: Record<string, unknown>): number | null {
  const v = row.organization_id ?? row.organizationId;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return null;
}

function resolveProviderColumn(colList: string[]): string | null {
  if (colList.includes('providerUrl')) return 'providerUrl';
  if (colList.includes('provider_url')) return 'provider_url';
  return null;
}

/**
 * Migrates legacy `registry_accounts` rows keyed by `user_id` to `organization_id`
 * (one row per organization + provider). Idempotent.
 */
export async function migrateRegistryAccountsToOrganizationScope(
  ds: DataSource,
): Promise<void> {
  if (!(await tableExists(ds, 'registry_accounts'))) {
    return;
  }

  const colList = await listColumns(ds, 'registry_accounts');
  const colSet = new Set(colList);
  const hasUserId = colSet.has('user_id') || colSet.has('userId');
  const userCol = colSet.has('user_id')
    ? 'user_id'
    : colSet.has('userId')
      ? 'userId'
      : null;
  const orgCol = colSet.has('organization_id')
    ? 'organization_id'
    : colSet.has('organizationId')
      ? 'organizationId'
      : null;

  if (!hasUserId || userCol == null) {
    return;
  }

  const dbType = String(ds.options.type);
  if (orgCol == null) {
    if (dbType === 'postgres') {
      await ds.query(
        `ALTER TABLE registry_accounts ADD COLUMN IF NOT EXISTS organization_id int`,
      );
    } else if (dbType === 'sqlite') {
      await ds.query(
        `ALTER TABLE registry_accounts ADD COLUMN organization_id integer`,
      );
    } else {
      log.warn(
        `registry_accounts: unsupported DB type "${dbType}" for organization_id migration.`,
      );
      return;
    }
  }

  const colListFresh = await listColumns(ds, 'registry_accounts');
  const effectiveOrgCol = colListFresh.includes('organization_id')
    ? 'organization_id'
    : 'organizationId';
  const providerCol = resolveProviderColumn(colListFresh);
  if (!providerCol) {
    log.warn('registry_accounts: could not resolve provider URL column; skipping migration.');
    return;
  }

  const memRepo = ds.getRepository(OrganizationMembership);
  const rows = (await ds.query(
    `SELECT * FROM registry_accounts`,
  )) as Record<string, unknown>[];

  let maxId = 0;
  for (const row of rows) {
    const id = pickId(row);
    if (id != null && id > maxId) maxId = id;
  }

  const placeholder = (n: number) => (dbType === 'postgres' ? `$${n}` : '?');

  const dataColumnNames = colListFresh.filter(
    (c) =>
      c !== 'id' &&
      c !== userCol &&
      c !== 'organization_id' &&
      c !== 'organizationId',
  );

  for (const row of rows) {
    const rowId = pickId(row);
    if (rowId == null) continue;

    if (pickOrgId(row) != null) {
      continue;
    }

    const uid = pickUserId(row);
    if (uid == null) {
      await ds.query(
        dbType === 'postgres'
          ? `DELETE FROM registry_accounts WHERE id = $1`
          : `DELETE FROM registry_accounts WHERE id = ?`,
        [rowId],
      );
      continue;
    }

    const memberships = await memRepo.find({
      where: { userId: uid },
      order: { createdAt: 'ASC' },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    if (orgIds.length === 0) {
      log.warn(
        `registry_accounts row id=${rowId}: user ${uid} has no organization membership; removing row.`,
      );
      await ds.query(
        dbType === 'postgres'
          ? `DELETE FROM registry_accounts WHERE id = $1`
          : `DELETE FROM registry_accounts WHERE id = ?`,
        [rowId],
      );
      continue;
    }

    const [firstOrg, ...extraOrgs] = orgIds;

    const orgSetSql =
      effectiveOrgCol === 'organization_id'
        ? dbType === 'postgres'
          ? `UPDATE registry_accounts SET organization_id = $1 WHERE id = $2`
          : `UPDATE registry_accounts SET organization_id = ? WHERE id = ?`
        : dbType === 'postgres'
          ? `UPDATE registry_accounts SET "organizationId" = $1 WHERE id = $2`
          : `UPDATE registry_accounts SET "organizationId" = ? WHERE id = ?`;
    await ds.query(orgSetSql, [firstOrg, rowId]);

    const src = (
      await ds.query(
        dbType === 'postgres'
          ? `SELECT * FROM registry_accounts WHERE id = $1`
          : `SELECT * FROM registry_accounts WHERE id = ?`,
        [rowId],
      )
    )[0] as Record<string, unknown>;

    for (const oid of extraOrgs) {
      maxId += 1;
      const newId = maxId;
      const insertCols = ['id', effectiveOrgCol, ...dataColumnNames];
      const colSql = insertCols.map(qIdent).join(', ');
      const vals: unknown[] = [];
      const ph: string[] = [];
      let i = 1;
      vals.push(newId, oid);
      ph.push(placeholder(i++), placeholder(i++));
      for (const c of dataColumnNames) {
        vals.push(src[c]);
        ph.push(placeholder(i++));
      }
      await ds.query(
        `INSERT INTO registry_accounts (${colSql}) VALUES (${ph.join(', ')})`,
        vals,
      );
    }
  }

  if (dbType === 'postgres') {
    const legacyIdx = (await ds.query(
      `SELECT i.relname AS index_name, pg_get_indexdef(ix.indexrelid) AS def
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE t.relname = 'registry_accounts'
         AND n.nspname = current_schema()
         AND ix.indisunique = true
         AND NOT ix.indisprimary`,
    )) as { index_name: string; def: string }[];
    for (const { index_name, def } of legacyIdx) {
      const d = String(def ?? '').toLowerCase();
      if (d.includes('user_id') && (d.includes('provider') || d.includes('providerurl'))) {
        await ds.query(`DROP INDEX IF EXISTS ${qIdent(index_name)}`);
      }
    }
    await ds.query(
      `ALTER TABLE registry_accounts DROP COLUMN IF EXISTS user_id`,
    );
    await ds.query(
      `ALTER TABLE registry_accounts DROP COLUMN IF EXISTS "userId"`,
    );
    await ds.query(
      `ALTER TABLE registry_accounts ALTER COLUMN organization_id SET NOT NULL`,
    );
    const provQuoted = qIdent(providerCol);
    const orgQuoted = qIdent('organization_id');
    await ds.query(
      `DROP INDEX IF EXISTS "UQ_registry_accounts_organization_id_provider"`,
    );
    await ds.query(
      `CREATE INDEX IF NOT EXISTS "IDX_registry_accounts_organization_id_provider"
       ON registry_accounts (${orgQuoted}, ${provQuoted})`,
    );
    try {
      await ds.query(`
        CREATE SEQUENCE IF NOT EXISTS registry_accounts_id_seq;
        SELECT setval(
          'registry_accounts_id_seq',
          GREATEST((SELECT COALESCE(MAX(id), 1) FROM registry_accounts), 1)
        );
        ALTER TABLE registry_accounts
          ALTER COLUMN id SET DEFAULT nextval('registry_accounts_id_seq');
      `);
    } catch (e) {
      log.warn(
        `Could not attach id sequence to registry_accounts: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (dbType === 'sqlite') {
    const idxRows = (await ds.query(
      `PRAGMA index_list('registry_accounts')`,
    )) as { name: string; unique: number }[];
    for (const r of idxRows) {
      if (!r?.name || !Number(r.unique)) continue;
      const safeIdx = String(r.name).replace(/[^a-zA-Z0-9_]/g, '');
      if (safeIdx !== r.name) continue;
      const info = (await ds.query(
        `PRAGMA index_info("${safeIdx}")`,
      )) as { name: string }[];
      const cols = info.map((x) => x.name).join(' ');
      if (cols.includes('user_id') && cols.includes(providerCol)) {
        await ds.query(`DROP INDEX IF EXISTS "${safeIdx}"`);
      }
    }
    await ds.query(
      `DROP INDEX IF EXISTS "UQ_registry_accounts_organization_id_provider"`,
    );
    await ds.query(
      `CREATE INDEX IF NOT EXISTS "IDX_registry_accounts_organization_id_provider"
       ON registry_accounts (organization_id, ${qIdent(providerCol)})`,
    );
    try {
      await ds.query(`ALTER TABLE registry_accounts DROP COLUMN user_id`);
    } catch {
      try {
        await ds.query(`ALTER TABLE registry_accounts DROP COLUMN "userId"`);
      } catch (e) {
        log.warn(
          `SQLite: could not DROP user_id column: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  log.log('registry_accounts: migrated to organization_id scope.');
}
