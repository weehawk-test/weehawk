import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generatePublicId } from '../../common/public-id';
import { notificationChannelConfigTransformer } from '../notification-channel-config.transformer';
import { NotificationChannelType } from './notification-channel-type.enum';

@Entity({ name: 'notification_channels' })
export class NotificationChannel {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  publicId!: string;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'simple-enum', enum: NotificationChannelType })
  type!: NotificationChannelType;

  /**
   * Provider-specific credentials and targets (token, webhook URL, SMTP settings, etc.).
   * Stored encrypted at rest (AES-256-GCM; requires `WEEHAWK_ENCRYPTION_KEY`).
   */
  @Column({
    type: 'text',
    nullable: true,
    transformer: notificationChannelConfigTransformer,
  })
  config!: Record<string, unknown> | null;

  /**
   * When set, Send/Test from the API runs `curl` (same logic as cron/webhook scripts) on this
   * deploy host over SSH so outbound traffic originates from the customer's server.
   */
  @Column({ name: 'remote_server_id', type: 'int', nullable: true })
  remoteServerId!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @BeforeInsert()
  ensurePublicId() {
    if (!this.publicId) this.publicId = generatePublicId('nch');
  }
}
