import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DatabaseBackupConfigDto } from './database-backup-config.dto';

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MaxLength(4000)
  notifyMessage?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUUID('4')
  notifyChannelId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Optional remote server id for docker_command. Null runs on API host.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  remoteServerId?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Saved S3 profile name for backup upload, or null to clear.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  backupS3ProfileName?: string | null;

  @ApiPropertyOptional({ type: DatabaseBackupConfigDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => DatabaseBackupConfigDto)
  databaseBackupConfig?: DatabaseBackupConfigDto | null;

  @ApiPropertyOptional({ nullable: true, description: 'Bash script to execute for docker_command action.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  dockerCommand?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Parent domain (e.g. example.com) → weehawk-webhook.example.com; null clears public host (IP:port URL).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MaxLength(255)
  hooksPublicHost?: string | null;

  @ApiPropertyOptional({
    enum: ['http', 'https'],
    description: 'Scheme for the remote trigger URL (docker_command only).',
  })
  @IsOptional()
  @IsIn(['http', 'https'])
  remoteTriggerUrlScheme?: 'http' | 'https';
}
