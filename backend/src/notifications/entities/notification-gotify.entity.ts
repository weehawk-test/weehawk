import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationChannel } from './notification-channel.entity';

@Entity({ name: 'notification_gotify' })
export class NotificationGotify {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'channel_id', type: 'uuid', unique: true })
  channelId!: string;

  @OneToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel;

  @Column({ name: 'server_url', type: 'text' })
  serverUrl!: string;

  @Column({ name: 'app_token', type: 'text' })
  appToken!: string;

  @Column({ type: 'int', default: 5 })
  priority!: number;
}

