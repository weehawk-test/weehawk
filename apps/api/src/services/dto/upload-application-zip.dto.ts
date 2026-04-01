import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UploadApplicationZipDto {
  @ApiPropertyOptional({
    description: 'Path to build context inside the extracted archive',
    example: '.',
    default: '.',
  })
  @IsOptional()
  @IsString()
  buildPath?: string;

  @ApiPropertyOptional({
    description:
      'Optional path to Dockerfile relative to buildPath. If omitted, the server auto-detects a Dockerfile name (case-insensitive).',
    example: 'Dockerfile',
  })
  @IsOptional()
  @IsString()
  dockerfilePath?: string;

  @ApiPropertyOptional({
    description:
      'Build strategy: `dockerfile` (auto-detect Dockerfile) or `nixpacks` (Nixpacks generates Dockerfile and builds; requires `nixpacks` CLI on the server).',
    example: 'dockerfile',
    enum: ['dockerfile', 'nixpacks'],
    default: 'dockerfile',
  })
  @IsOptional()
  @IsIn(['dockerfile', 'nixpacks'])
  buildMode?: 'dockerfile' | 'nixpacks';

  @ApiPropertyOptional({
    description: 'Container port exposed by the app',
    example: 3000,
    default: 3000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  containerPort?: number;

  @ApiPropertyOptional({
    description: 'Optional host publish port',
    example: 8080,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  publishPort?: number;

  @ApiPropertyOptional({
    description: 'Swarm replicas for the generated stack',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  replicas?: number;

  @ApiPropertyOptional({
    description:
      'JSON array for application variables [{key,value,store}] where store is env|secret',
    example:
      '[{"key":"DATABASE_URL","value":"postgres://...","store":"secret"},{"key":"NODE_ENV","value":"production","store":"env"}]',
  })
  @IsOptional()
  @IsString()
  variablesJson?: string;
}
