import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  Min,
  IsOptional,
  IsString,
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

  @ApiPropertyOptional({ nullable: true, description: 'Numeric notification channel id, or null to clear.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsInt()
  @Min(1)
  @Type(() => Number)
  notifyChannelId?: number | null;

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
      'Public hostname (e.g. example.com or hooks.example.com); null clears public host (IP:port URL).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MaxLength(255)
  hooksPublicHost?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'API origin for POST /weehawk-hooks/{token} (full UI redeploy). Null clears (use deploy-host agent URL).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MaxLength(512)
  hooksTriggerOrigin?: string | null;
}
