import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Generate application stack from stored remote-git binding (source is cloned on the deploy host, not on the API). */
export class ApplicationGenerateFromSourceDto {
  @ApiPropertyOptional({ example: '.', default: '.' })
  @IsOptional()
  @IsString()
  buildPath?: string;

  @ApiPropertyOptional({ example: 'Dockerfile' })
  @IsOptional()
  @IsString()
  dockerfilePath?: string;

  @ApiPropertyOptional({ example: 'dockerfile', enum: ['dockerfile', 'nixpacks'] })
  @IsOptional()
  @IsIn(['dockerfile', 'nixpacks'])
  buildMode?: 'dockerfile' | 'nixpacks';

  @ApiPropertyOptional({ example: 3000, default: 3000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  containerPort?: number;

  @ApiPropertyOptional({ example: 8080 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  publishPort?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  replicas?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variablesJson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  networksJson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalNetworks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stackNetworks?: string;
}
