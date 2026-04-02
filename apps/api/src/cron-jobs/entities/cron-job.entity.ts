import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import type { DatabaseBackupConfig } from '../../backup/database-backup.types';
import type { WebhookServiceAction, WebhookTargetMode } from '../../webhooks/entities/webhook.entity';

@Entity({ name: 'cron_jobs' })
export class CronJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'cron_expression', type: 'varchar', length: 64 })
  cronExpression!: string;

  @Column({ name: 'target_mode', type: 'varchar', length: 24 })
  targetMode!: WebhookTargetMode;

  @Column({ name: 'service_id', type: 'int', nullable: true })
  serviceId: number | null = null;

  @Column({
    name: 'service_action',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  serviceAction: WebhookServiceAction | null = null;

  @Column({ name: 'volume_source', type: 'varchar', length: 512, nullable: true })
  volumeSource: string | null = null;

  @Column({ name: 'docker_command', type: 'text', nullable: true })
  dockerCommand: string | null = null;

  @Column({ name: 'database_backup_config', type: 'json', nullable: true })
  databaseBackupConfig: DatabaseBackupConfig | null = null;

  @Column({ name: 'backup_s3_profile_name', type: 'varchar', length: 191, nullable: true })
  backupS3ProfileName: string | null = null;

  @Column({ name: 'notify_on_trigger', default: false })
  notifyOnTrigger!: boolean;

  @Column({ name: 'notify_channel_id', type: 'uuid', nullable: true })
  notifyChannelId: string | null = null;

  @Column({ name: 'notify_message', type: 'text', nullable: true })
  notifyMessage: string | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
