import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  WebhookServiceAction,
  WebhookTargetMode,
} from '../entities/webhook.entity';
import { DatabaseBackupConfigDto } from './database-backup-config.dto';

export class CreateWebhookDto {
  @ApiProperty({ example: 'CI redeploy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: ['service'] })
  @IsEnum(['service'] as const)
  targetMode!: WebhookTargetMode;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateWebhookDto) =>
      o.targetMode === 'service' &&
      o.serviceAction !== 'no_action' &&
      o.serviceAction !== 'docker_command',
  )
  @IsInt()
  @Min(1)
  serviceId?: number;

  @ApiPropertyOptional({
    description:
      'Optional remote server id for docker_command. When omitted, script runs on API host.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  remoteServerId?: number;

  @ApiPropertyOptional({
    enum: ['redeploy', 'volume_backup', 'database_backup', 'docker_command', 'no_action'],
  })
  @ValidateIf((o: CreateWebhookDto) => o.targetMode === 'service')
  @IsEnum(
    ['redeploy', 'volume_backup', 'database_backup', 'docker_command', 'no_action'] as const,
  )
  serviceAction?: WebhookServiceAction;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateWebhookDto) =>
      o.targetMode === 'service' && o.serviceAction === 'volume_backup',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  volumeSource?: string;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateWebhookDto) =>
      o.targetMode === 'service' && o.serviceAction === 'docker_command',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  dockerCommand?: string;

  @ApiPropertyOptional({ type: DatabaseBackupConfigDto })
  @ValidateIf(
    (o: CreateWebhookDto) =>
      o.targetMode === 'service' && o.serviceAction === 'database_backup',
  )
  @ValidateNested()
  @Type(() => DatabaseBackupConfigDto)
  databaseBackupConfig?: DatabaseBackupConfigDto;

  @ApiProperty({
    description:
      'Saved S3 profile name (required when serviceAction is volume_backup or database_backup).',
  })
  @ValidateIf(
    (o: CreateWebhookDto) =>
      o.targetMode === 'service' &&
      (o.serviceAction === 'volume_backup' || o.serviceAction === 'database_backup'),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  backupS3ProfileName?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  notifyChannelId?: string;

  @ApiPropertyOptional({ example: 'Backup completed successfully.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notifyMessage?: string;
}
