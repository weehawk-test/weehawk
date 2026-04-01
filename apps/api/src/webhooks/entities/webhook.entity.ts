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

/** service = run Docker action on a service */
export type WebhookTargetMode = 'service';

/** Action when targetMode is service */
export type WebhookServiceAction =
  | 'redeploy'
  | 'volume_backup'
  | 'docker_command'
  | 'no_action';

@Entity({ name: 'webhooks' })
export class Webhook {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Secret segment in public URL */
  @Column({ name: 'secret_token', type: 'varchar', length: 96, unique: true })
  secretToken!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

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
