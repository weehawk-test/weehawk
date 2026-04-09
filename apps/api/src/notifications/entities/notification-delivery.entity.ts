import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationChannel } from './notification-channel.entity';
import { NotificationDeliveryStatus } from './notification-delivery-status.enum';
import { Notification } from './notification.entity';

@Entity({ name: 'notification_deliveries' })
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'notification_id', type: 'varchar', length: 36 })
  notificationId!: string;

  @ManyToOne(() => Notification, (n) => n.deliveries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'notification_id' })
  notification!: Notification;

  /** Nullable for draft credential tests that are not tied to a saved channel. */
  @Column({ name: 'channel_id', type: 'varchar', length: 36, nullable: true })
  channelId!: string | null;

  @ManyToOne(() => NotificationChannel, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel | null;

  @Column({
    type: 'simple-enum',
    enum: NotificationDeliveryStatus,
  })
  status!: NotificationDeliveryStatus;

  /** Provider response body, error text, or structured metadata (JSON stringified when object). */
  @Column({ type: 'text', nullable: true })
  response!: string | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
