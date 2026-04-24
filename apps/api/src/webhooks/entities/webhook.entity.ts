import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generatePublicId } from '../../common/public-id';

/** Scheme shown in the remote trigger URL (Traefik hostname or IP:port). */
export type WebhookRemoteTriggerUrlScheme = 'https';

@Entity({ name: 'webhooks' })
export class Webhook {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  publicId!: string;

  /** Secret segment in public URL */
  @Column({ name: 'secret_token', type: 'varchar', length: 96, unique: true })
  secretToken!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ name: 'service_id', type: 'int', nullable: true })
  serviceId: number | null = null;

  @Column({ name: 'remote_server_id', type: 'int', nullable: true })
  remoteServerId: number | null = null;

  /** Bash body deployed to the remote webhook agent */
  @Column({ name: 'bash_script', type: 'text', nullable: true })
  bashScript: string | null = null;

  @Column({ name: 'notify_on_trigger', default: false })
  notifyOnTrigger!: boolean;

  @Column({ name: 'notify_channel_id', type: 'int', nullable: true })
  notifyChannelId: number | null = null;

  @Column({ name: 'notify_message', type: 'text', nullable: true })
  notifyMessage: string | null = null;

  /**
   * Optional hostname for the on-server webhook agent behind Traefik (e.g. `hooks.example.com`).
   * Requires API `WEEHAWK_WEBHOOK_AGENT_IMAGE` and Swarm + overlay {@code weehawk} on the deploy host.
   */
  @Column({ name: 'hooks_public_host', type: 'varchar', length: 255, nullable: true })
  hooksPublicHost: string | null = null;

  /**
   * URL scheme for the remote bash trigger URL.
   * Always HTTPS.
   */
  @Column({
    name: 'remote_trigger_url_scheme',
    type: 'varchar',
    length: 8,
    default: 'https',
  })
  remoteTriggerUrlScheme!: WebhookRemoteTriggerUrlScheme;

  /**
   * When true, omitted from GET /api/webhooks (manual list); use ?includeHidden=true to list for service UI.
   */
  @Column({ name: 'hidden_from_webhooks_list', default: false })
  hiddenFromWebhooksList!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @BeforeInsert()
  ensurePublicId() {
    if (!this.publicId) this.publicId = generatePublicId('whk');
  }
}
