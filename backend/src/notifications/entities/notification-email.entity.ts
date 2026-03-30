import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationChannel } from './notification-channel.entity';

@Entity({ name: 'notification_email' })
export class NotificationEmail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'channel_id', type: 'uuid', unique: true })
  channelId!: string;

  @OneToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel;

  @Column({ name: 'smtp_server', type: 'varchar', length: 255 })
  smtpServer!: string;

  @Column({ name: 'smtp_port', type: 'int' })
  smtpPort!: number;

  @Column({ type: 'varchar', length: 255 })
  username!: string;

  @Column({ type: 'text' })
  password!: string;

  @Column({ name: 'from_address', type: 'varchar', length: 255 })
  fromAddress!: string;

  @Column({ name: 'to_addresses_json', type: 'text' })
  toAddressesJson!: string;
}
