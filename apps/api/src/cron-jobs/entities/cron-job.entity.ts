import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generatePublicId } from '../../common/public-id';

@Entity({ name: 'cron_jobs' })
export class CronJob {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  publicId!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'cron_expression', type: 'varchar', length: 64 })
  cronExpression!: string;

  /** Deploy host where the script is installed and crontab runs. */
  @Column({ name: 'remote_server_id', type: 'int' })
  remoteServerId!: number;

  /** Bash body executed on the deploy host (wrapped script + Docker socket). */
  @Column({ name: 'bash_script', type: 'text' })
  bashScript!: string;

  @Column({ name: 'notify_on_trigger', default: false })
  notifyOnTrigger!: boolean;

  @Column({ name: 'notify_channel_id', type: 'int', nullable: true })
  notifyChannelId: number | null = null;

  @Column({ name: 'notify_message', type: 'text', nullable: true })
  notifyMessage: string | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @BeforeInsert()
  ensurePublicId() {
    if (!this.publicId) this.publicId = generatePublicId('crn');
  }
}
