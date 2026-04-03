import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ImportServiceBackupFromS3Dto {
  @ApiProperty({ enum: ['import_database', 'import_volume'] })
  @IsEnum(['import_database', 'import_volume'] as const)
  action!: 'import_database' | 'import_volume';

  @ApiProperty({ description: 'Saved S3 profile name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  backupS3ProfileName!: string;

  @ApiProperty({ description: 'Full object key in the bucket' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  s3Key!: string;

  @ApiPropertyOptional({
    description: 'JSON string of DatabaseBackupConfig (required for import_database)',
  })
  @ValidateIf((o: ImportServiceBackupFromS3Dto) => o.action === 'import_database')
  @IsString()
  @IsNotEmpty()
  databaseBackupConfig?: string;

  @ApiPropertyOptional({
    description: 'Volume name for import_volume',
  })
  @ValidateIf((o: ImportServiceBackupFromS3Dto) => o.action === 'import_volume')
  @IsString()
  @IsNotEmpty()
  volumeSource?: string;
}
