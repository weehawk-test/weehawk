import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateRegistryAccountDto {
  @ApiPropertyOptional({ example: 'GitHub GHCR' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'ghcr.io' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  providerUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  username?: string;

  @ApiPropertyOptional({ description: 'Password or personal access token' })
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  password?: string;
}
