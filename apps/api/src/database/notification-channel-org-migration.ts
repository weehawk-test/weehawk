import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const log = new Logger('NotificationChannelOrgMigration');

/**
 * Notification channels are organization-owned; drop legacy per-row user_id if present.
 */
export async function migrateNotificationChannelsOrganizationOwnership(
  ds: DataSource,
): Promise<void> {
  const dbType = String(ds.options.type);
  if (dbType === 'postgres') {
    try {
      await ds.query(
        `ALTER TABLE notification_channels DROP COLUMN IF EXISTS user_id`,
      );
    } catch (e) {
      log.warn(
        `postgres: could not drop notification_channels.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (dbType === 'sqlite') {
    try {
      await ds.query(`ALTER TABLE notification_channels DROP COLUMN user_id`);
    } catch (e) {
      log.warn(
        `sqlite: could not drop notification_channels.user_id: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  log.log(
    'notification_channels: organization ownership (dropped user_id if present).',
  );
}
