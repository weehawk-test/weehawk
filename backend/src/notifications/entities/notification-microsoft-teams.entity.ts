import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationChannel } from './notification-channel.entity';

@Entity({ name: 'notification_microsoft_teams' })
export class NotificationMicrosoftTeams {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'channel_id', type: 'uuid', unique: true })
  channelId!: string;

  @OneToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel!: NotificationChannel;

  @Column({ name: 'webhook_url', type: 'text' })
  webhookUrl!: string;
}

