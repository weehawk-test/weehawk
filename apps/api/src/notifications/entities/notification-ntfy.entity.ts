import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationChannel } from './notification-channel.entity';

@Entity({ name: 'notification_ntfy' })
export class NotificationNtfy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'channel_id', type: 'uuid', unique: true })
  channelId!: string;

  @OneToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel;

  @Column({ name: 'server_url', type: 'text' })
  serverUrl!: string;

  @Column({ type: 'varchar', length: 255 })
  topic!: string;

  @Column({ type: 'text', nullable: true })
  token!: string | null;
}
