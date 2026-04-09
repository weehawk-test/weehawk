import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationChannelType } from './notification-channel-type.enum';

@Entity({ name: 'notification_channels' })
export class NotificationChannel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'simple-enum', enum: NotificationChannelType })
  type!: NotificationChannelType;

  /** Provider-specific credentials and targets (token, webhook URL, SMTP settings, etc.). */
  @Column({ type: 'simple-json', nullable: true })
  config!: Record<string, unknown> | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
