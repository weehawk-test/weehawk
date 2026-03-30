import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationChannel } from './notification-channel.entity';

@Entity({ name: 'notification_resend' })
export class NotificationResend {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'channel_id', type: 'uuid', unique: true })
  channelId!: string;

  @OneToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel;

  @Column({ name: 'api_key', type: 'text' })
  apiKey!: string;

  @Column({ name: 'from_address', type: 'varchar', length: 255 })
  fromAddress!: string;

  @Column({ name: 'to_address', type: 'varchar', length: 255 })
  toAddress!: string;
}
