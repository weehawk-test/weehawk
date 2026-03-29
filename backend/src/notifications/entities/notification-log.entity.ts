import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { NotificationChannel } from './notification-channel.entity';

@Entity({ name: 'notification_logs' })
export class NotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @ManyToOne(() => NotificationChannel, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel | null;

  @Column({ name: 'channel_name', type: 'varchar', length: 200 })
  channelName!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'sent' | 'failed';

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null = null;

  @CreateDateColumn({ name: 'sent_at' })
  sentAt!: Date;
}
