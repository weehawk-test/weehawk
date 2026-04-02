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
} from '../../webhooks/entities/webhook.entity';
import { DatabaseBackupConfigDto } from '../../webhooks/dto/database-backup-config.dto';

export class CreateCronJobDto {
  @ApiProperty({ example: 'Nightly redeploy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '0 * * * *' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  cronExpression!: string;

  @ApiProperty({ enum: ['service'] })
  @IsEnum(['service'] as const)
  targetMode!: WebhookTargetMode;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateCronJobDto) =>
      o.targetMode === 'service' && o.serviceAction !== 'no_action',
  )
  @IsInt()
  @Min(1)
  serviceId?: number;

  @ApiPropertyOptional({
    enum: ['redeploy', 'volume_backup', 'database_backup', 'docker_command', 'no_action'],
  })
  @ValidateIf((o: CreateCronJobDto) => o.targetMode === 'service')
  @IsEnum(
    ['redeploy', 'volume_backup', 'database_backup', 'docker_command', 'no_action'] as const,
  )
  serviceAction?: WebhookServiceAction;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateCronJobDto) =>
      o.targetMode === 'service' && o.serviceAction === 'volume_backup',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  volumeSource?: string;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateCronJobDto) =>
      o.targetMode === 'service' && o.serviceAction === 'docker_command',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  dockerCommand?: string;

  @ApiPropertyOptional({ type: DatabaseBackupConfigDto })
  @ValidateIf(
    (o: CreateCronJobDto) =>
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
    (o: CreateCronJobDto) =>
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

  @ApiPropertyOptional({ example: 'Scheduled job finished.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notifyMessage?: string;
}
