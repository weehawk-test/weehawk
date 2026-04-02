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
      'Always Dockerfile-based: if a Dockerfile exists in the build context it is used; otherwise the server generates one (Node / Go / Python / static). Legacy values `buildpacks` / `nixpacks` are ignored.',
    example: 'dockerfile',
    enum: ['dockerfile', 'buildpacks', 'nixpacks'],
    default: 'dockerfile',
  })
  @IsOptional()
  @IsIn(['dockerfile', 'buildpacks', 'nixpacks'])
  buildMode?: 'dockerfile' | 'buildpacks' | 'nixpacks';

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

  @ApiPropertyOptional({
    description:
      'JSON object { "external": string[], "stack": string[] } for application networks. If omitted, networks from the existing config are kept.',
    example: '{"external":["myapp_default"],"stack":[]}',
  })
  @IsOptional()
  @IsString()
  networksJson?: string;

  @ApiPropertyOptional({
    description:
      'Pipe-separated Docker network names to attach (same as `external` in networksJson). Prefer this over JSON for multipart reliability.',
    example: 'mydb_default|otherapp_default',
  })
  @IsOptional()
  @IsString()
  externalNetworks?: string;

  @ApiPropertyOptional({
    description:
      'Pipe-separated stack overlay keys (same as `stack` in networksJson).',
    example: 'cache|sidecar',
  })
  @IsOptional()
  @IsString()
  stackNetworks?: string;
}
