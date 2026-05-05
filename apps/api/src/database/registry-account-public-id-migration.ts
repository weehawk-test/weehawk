import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { generatePublicId } from '../common/public-id';

const log = new Logger('RegistryAccountPublicId');

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

async function columnExists(
  ds: DataSource,
  table: string,
  column: string,
): Promise<boolean> {
  const t = String(ds.options.type);
  if (t === 'postgres') {
    const rows = await ds.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column],
    );
    return Array.isArray(rows) && rows.length > 0;
  }
  if (t === 'sqlite') {
    const rows = (await ds.query(
      `PRAGMA table_info(${table})`,
    )) as { name: string }[];
    return Array.isArray(rows) && rows.some((r) => r.name === column);
  }
  return false;
}

/**
 * Adds `public_id` to registry_accounts, backfills unique values. Idempotent.
 */
export async function migrateRegistryAccountPublicIds(
  ds: DataSource,
): Promise<void> {
  if (!(await tableExists(ds, 'registry_accounts'))) {
    return;
  }

  const dbType = String(ds.options.type);
  const hasCol = await columnExists(ds, 'registry_accounts', 'public_id');

  if (!hasCol) {
    if (dbType === 'postgres') {
      await ds.query(
        `ALTER TABLE registry_accounts ADD COLUMN IF NOT EXISTS public_id varchar(40)`,
      );
    } else if (dbType === 'sqlite') {
      await ds.query(
        `ALTER TABLE registry_accounts ADD COLUMN public_id varchar(40)`,
      );
    } else {
      log.warn(
        `registry_accounts public_id: unsupported DB type "${dbType}".`,
      );
      return;
    }
  }

  const ph = (n: number) => (dbType === 'postgres' ? `$${n}` : '?');

  const rows = (await ds.query(
    `SELECT id, public_id FROM registry_accounts`,
  )) as { id: number; public_id: string | null }[];

  for (const r of rows) {
    const existing = r.public_id?.trim();
    if (existing) continue;

    let assigned: string | null = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = generatePublicId('reg');
      const clash = await ds.query(
        `SELECT 1 FROM registry_accounts WHERE public_id = ${ph(1)} LIMIT 1`,
        [candidate],
      );
      if (!Array.isArray(clash) || clash.length === 0) {
        assigned = candidate;
        break;
      }
    }
    if (!assigned) {
      throw new Error('registry_accounts: could not allocate unique public_id');
    }
    await ds.query(
      `UPDATE registry_accounts SET public_id = ${ph(1)} WHERE id = ${ph(2)}`,
      [assigned, r.id],
    );
  }

  if (dbType === 'postgres') {
    await ds.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_registry_accounts_public_id" ON registry_accounts (public_id)`,
    );
    try {
      await ds.query(
        `ALTER TABLE registry_accounts ALTER COLUMN public_id SET NOT NULL`,
      );
    } catch (e) {
      log.warn(
        `registry_accounts: could not set public_id NOT NULL: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (dbType === 'sqlite') {
    await ds.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_registry_accounts_public_id" ON registry_accounts (public_id)`,
    );
  }

  log.log('registry_accounts: public_id column ensured and backfilled.');
}
