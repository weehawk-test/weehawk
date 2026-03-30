import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
} from 'class-validator';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';

export const NOTIFICATION_CHANNEL_TYPES = Object.values(
  NotificationChannelType,
);

export type NotificationChannelTypeValue =
  (typeof NOTIFICATION_CHANNEL_TYPES)[number];

export class CreateNotificationChannelDto {
  @ApiProperty({ example: 'Production Alerts', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    example: 'telegram',
    enum: NOTIFICATION_CHANNEL_TYPES,
    default: 'telegram',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(NOTIFICATION_CHANNEL_TYPES)
  @MaxLength(32)
  type!: NotificationChannelTypeValue;

  @ApiProperty({
    example: {
      token: '123456789:AA...',
      target: '-1001234567890',
    },
    description: 'Channel-specific configuration payload',
  })
  @IsObject()
  config!: Record<string, unknown>;
}
