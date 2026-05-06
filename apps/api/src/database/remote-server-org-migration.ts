import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const log = new Logger('RemoteServerOrgMigration');

/**
 * Remote servers are organization-owned; drop legacy per-row user_id if present.
 */
export async function migrateRemoteServersOrganizationOwnership(
  ds: DataSource,
): Promise<void> {
  const dbType = String(ds.options.type);
  if (dbType === 'postgres') {
    try {
      await ds.query(
        `ALTER TABLE remote_servers DROP COLUMN IF EXISTS user_id`,
      );
    } catch (e) {
      log.warn(
        `postgres: could not drop remote_servers.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (dbType === 'sqlite') {
    try {
      await ds.query(`ALTER TABLE remote_servers DROP COLUMN user_id`);
    } catch (e) {
      log.warn(
        `sqlite: could not drop remote_servers.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  log.log(
    'remote_servers: organization ownership (dropped user_id if present).',
  );
}
