import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const log = new Logger('S3ProfileOrgMigration');

/**
 * S3 profiles are organization-owned; drop legacy per-row user_id if present.
 */
export async function migrateS3ProfilesOrganizationOwnership(
  ds: DataSource,
): Promise<void> {
  const dbType = String(ds.options.type);
  if (dbType === 'postgres') {
    try {
      await ds.query(`ALTER TABLE s3_profiles DROP COLUMN IF EXISTS user_id`);
    } catch (e) {
      log.warn(
        `postgres: could not drop s3_profiles.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (dbType === 'sqlite') {
    try {
      await ds.query(`ALTER TABLE s3_profiles DROP COLUMN user_id`);
    } catch (e) {
      log.warn(
        `sqlite: could not drop s3_profiles.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  log.log('s3_profiles: organization ownership (dropped user_id if present).');
}
