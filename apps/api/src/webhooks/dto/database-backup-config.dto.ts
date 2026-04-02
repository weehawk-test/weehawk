import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateIf,
} from 'class-validator';
import { BackupFormatMatchesEngine } from '../../backup/database-backup-format.validator';
import type { DatabaseBackupEngine } from '../../backup/database-backup.types';

export class DatabaseBackupConfigDto {
  @ApiProperty({ enum: ['postgres', 'mysql', 'mariadb', 'mongodb', 'redis'] })
  @IsEnum(['postgres', 'mysql', 'mariadb', 'mongodb', 'redis'] as const)
  engine!: DatabaseBackupEngine;

  @ApiProperty({ example: 'postgres' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  composeService!: string;

  @ApiPropertyOptional({ example: 'mydb' })
  @ValidateIf((o: DatabaseBackupConfigDto) => o.engine !== 'redis')
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  databaseName?: string;

  @ApiPropertyOptional({ example: 'postgres' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  dbUser?: string;

  @ApiPropertyOptional({
    description:
      'Backup output variant (engine-specific), e.g. postgres_sql_gzip, postgres_custom_gzip, mysql_sql_extended_gzip.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  @Validate(BackupFormatMatchesEngine)
  backupFormat?: string;
}
