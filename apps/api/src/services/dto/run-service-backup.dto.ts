import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DatabaseBackupConfigDto } from '../../webhooks/dto/database-backup-config.dto';

export class RunServiceBackupDto {
  @ApiProperty({ enum: ['volume_backup', 'database_backup'] })
  @IsEnum(['volume_backup', 'database_backup'] as const)
  action!: 'volume_backup' | 'database_backup';

  @ApiPropertyOptional({
    description:
      'Named Docker volume name (or compose volume source) for volume_backup.',
  })
  @ValidateIf((o: RunServiceBackupDto) => o.action === 'volume_backup')
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  volumeSource?: string;

  @ApiPropertyOptional({ type: DatabaseBackupConfigDto })
  @ValidateIf((o: RunServiceBackupDto) => o.action === 'database_backup')
  @ValidateNested()
  @Type(() => DatabaseBackupConfigDto)
  databaseBackupConfig?: DatabaseBackupConfigDto;

  @ApiProperty({
    description:
      'Saved S3 profile: display name or `publicId` (same as in Settings → S3).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  backupS3ProfileName!: string;
}
