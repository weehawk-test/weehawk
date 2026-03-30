import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class PostgresDatabaseDto {
  @ApiProperty({ example: 'myapp-db' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(63)
  dbName!: string;

  @ApiProperty({ example: 'appuser' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(63)
  user!: string;

  @ApiProperty({ example: 'secret' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(256)
  pass!: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  replicas?: number;

  /** Host port published to the container’s 5432. Omit or leave unset so the stack has no `ports` mapping. */
  @ApiPropertyOptional({ example: 5432, description: '1–65535; omit to keep Postgres internal-only.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  publishPort?: number;

  /** Docker image (e.g. postgres:16-alpine). Omit to use server default. */
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
}
