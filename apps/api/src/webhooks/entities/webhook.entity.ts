import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { DatabaseBackupConfig } from '../../backup/database-backup.types';

/** service = run Docker action on a service */
export type WebhookTargetMode = 'service';

/** Action when targetMode is service */
export type WebhookServiceAction =
  | 'redeploy'
  | 'volume_backup'
  | 'database_backup'
  | 'docker_command'
  | 'no_action';

/** Scheme shown in the remote trigger URL (Traefik hostname or IP:port). */
export type WebhookRemoteTriggerUrlScheme = 'http' | 'https';

@Entity({ name: 'webhooks' })
export class Webhook {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Secret segment in public URL */
  @Column({ name: 'secret_token', type: 'varchar', length: 96, unique: true })
  secretToken!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'target_mode', type: 'varchar', length: 24 })
  targetMode!: WebhookTargetMode;

  @Column({ name: 'service_id', type: 'int', nullable: true })
  serviceId: number | null = null;

  @Column({ name: 'remote_server_id', type: 'int', nullable: true })
  remoteServerId: number | null = null;

  @Column({
    name: 'service_action',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  serviceAction: WebhookServiceAction | null = null;

  /** Named volume name (or compose volume source) for volume_backup */
  @Column({
    name: 'volume_source',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  volumeSource: string | null = null;

  /** Full docker CLI line; server enforces `docker` prefix */
  @Column({ name: 'docker_command', type: 'text', nullable: true })
  dockerCommand: string | null = null;

  /** Structured database backup (preferred over `docker_command` for database_backup) */
  @Column({ name: 'database_backup_config', type: 'json', nullable: true })
  databaseBackupConfig: DatabaseBackupConfig | null = null;

  /** Saved S3 profile name (`s3_profiles.name`) for optional upload after volume/database backup */
  @Column({ name: 'backup_s3_profile_name', type: 'varchar', length: 191, nullable: true })
  backupS3ProfileName: string | null = null;

  @Column({ name: 'notify_on_trigger', default: false })
  notifyOnTrigger!: boolean;

  @Column({ name: 'notify_channel_id', type: 'varchar', length: 36, nullable: true })
  notifyChannelId: string | null = null;

  @Column({ name: 'notify_message', type: 'text', nullable: true })
  notifyMessage: string | null = null;

  /**
   * Optional hostname for the on-server webhook agent behind Traefik (e.g. `hooks.example.com`).
   * Requires API `WEEHAWK_WEBHOOK_AGENT_IMAGE` and Swarm + overlay {@code weehawk} on the deploy host.
   */
  @Column({ name: 'hooks_public_host', type: 'varchar', length: 255, nullable: true })
  hooksPublicHost: string | null = null;

  /**
   * URL scheme for the remote bash trigger URL when `serviceAction` is docker_command.
   * Set per webhook in the API/UI (not a global env default).
   */
  @Column({
    name: 'remote_trigger_url_scheme',
    type: 'varchar',
    length: 8,
    default: 'http',
  })
  remoteTriggerUrlScheme!: WebhookRemoteTriggerUrlScheme;

  /**
   * Optional legacy field; on-host redeploy no longer calls back to the API. May be null.
   */
  @Column({ name: 'hooks_trigger_origin', type: 'varchar', length: 512, nullable: true })
  hooksTriggerOrigin: string | null = null;

  /**
   * When true, omitted from GET /api/webhooks (manual list); use ?includeHidden=true to list for service UI.
   */
  @Column({ name: 'hidden_from_webhooks_list', default: false })
  hiddenFromWebhooksList!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
