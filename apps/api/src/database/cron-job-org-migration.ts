import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const log = new Logger('CronJobOrgMigration');

/**
 * Cron jobs are organization-owned; drop legacy per-row user_id if present.
 */
export async function migrateCronJobsOrganizationOwnership(
  ds: DataSource,
): Promise<void> {
  const dbType = String(ds.options.type);
  if (dbType === 'postgres') {
    try {
      await ds.query(`ALTER TABLE cron_jobs DROP COLUMN IF EXISTS user_id`);
    } catch (e) {
      log.warn(
        `postgres: could not drop cron_jobs.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (dbType === 'sqlite') {
    try {
      await ds.query(`ALTER TABLE cron_jobs DROP COLUMN user_id`);
    } catch (e) {
      log.warn(
        `sqlite: could not drop cron_jobs.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  log.log('cron_jobs: organization ownership (dropped user_id if present).');
}
