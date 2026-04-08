import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DatabaseBackupConfigDto } from '../../webhooks/dto/database-backup-config.dto';

export class UpdateCronJobDto {
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

  @ApiPropertyOptional({ example: '*/10 * * * *' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cronExpression?: string;

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

  @ApiPropertyOptional({ nullable: true })
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
}
