import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const log = new Logger('ProjectOrgMigration');

/**
 * Projects are organization-owned; drop legacy per-row user_id if present.
 */
export async function migrateProjectsOrganizationOwnership(
  ds: DataSource,
): Promise<void> {
  const dbType = String(ds.options.type);
  if (dbType === 'postgres') {
    try {
      await ds.query(`ALTER TABLE projects DROP COLUMN IF EXISTS user_id`);
    } catch (e) {
      log.warn(
        `postgres: could not drop projects.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (dbType === 'sqlite') {
    try {
      await ds.query(`ALTER TABLE projects DROP COLUMN user_id`);
    } catch (e) {
      log.warn(
        `sqlite: could not drop projects.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  log.log('projects: organization ownership (dropped user_id if present).');
}
