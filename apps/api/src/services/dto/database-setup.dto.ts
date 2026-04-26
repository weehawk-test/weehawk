import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class DatabaseSetupDto {
  @ApiPropertyOptional({ example: 'myapp-db' })
  @IsOptional()
  @IsString()
  @MaxLength(63)
  dbName?: string;

  @ApiPropertyOptional({ example: 'appuser' })
  @IsOptional()
  @IsString()
  @MaxLength(63)
  user?: string;

  @ApiPropertyOptional({ example: 'secret' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  pass?: string;

  @ApiPropertyOptional({ example: 'root' })
  @IsOptional()
  @IsString()
  @MaxLength(63)
  rootUser?: string;

  @ApiPropertyOptional({ example: 'root-secret' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  rootPass?: string;

  @ApiPropertyOptional({ example: 'secret' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  replicas?: number;

  @ApiPropertyOptional({ example: 5432, description: '1–65535; omit to keep internal-only.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  publishPort?: number;

  @ApiPropertyOptional({ example: 'postgres:18-alpine' })
  @IsOptional()
  @ValidateIf((_, v) => typeof v === 'string' && v.trim().length > 0)
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,127}$/, {
    message:
      'Invalid image reference (allowed: letters, digits, ._/:@-; max 128 chars)',
  })
  image?: string;

  @ApiPropertyOptional({
    example: '/var/lib/postgresql',
    description:
      'Container data directory path for the named volume mount (must start with /).',
  })
  @IsOptional()
  @ValidateIf((_, v) => typeof v === 'string' && v.trim().length > 0)
  @IsString()
  @MaxLength(200)
  @Matches(/^\/[^\s]*$/, {
    message: 'Invalid volume path (must start with / and contain no spaces)',
  })
  volumePath?: string;
}
