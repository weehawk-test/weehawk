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
import { NotificationChannelType } from './notification-channel-type.enum';

@Entity({ name: 'notification_channels' })
export class NotificationChannel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'enum', enum: NotificationChannelType })
  type!: NotificationChannelType;

  /** Provider-specific credentials and targets (token, webhook URL, SMTP settings, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
