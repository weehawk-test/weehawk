import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationChannel } from './notification-channel.entity';

@Entity({ name: 'notification_pushover' })
export class NotificationPushover {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'channel_id', type: 'uuid', unique: true })
  channelId!: string;

  @OneToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel;

  @Column({ name: 'app_token', type: 'text' })
  appToken!: string;

  @Column({ name: 'user_key', type: 'text' })
  userKey!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  device!: string | null;
}

