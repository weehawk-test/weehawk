import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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

  @ApiPropertyOptional({
    description:
      'Optional at create time. When set, deliveries and tests use this deploy host (SSH + curl). Omit to save the channel and assign a host later (e.g. via PATCH).',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  remoteServerId?: number;

  @ApiPropertyOptional({
    description:
      'Organization workspace: channel is shared with org members (not the personal account).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  organizationPublicId?: string;
}
