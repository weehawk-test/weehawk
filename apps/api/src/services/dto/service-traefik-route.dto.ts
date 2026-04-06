import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** One Traefik router: hosts + optional PathPrefix + optional port override (defaults to app container port). */
export class ServiceTraefikRouteDto {
  @ApiProperty({ example: 'backend' })
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  @Matches(/^[a-z][a-z0-9_-]*$/, {
    message:
      'router must start with a letter; only lowercase letters, digits, hyphen, underscore',
  })
  router!: string;

  @ApiProperty({ example: ['api.example.com', 'www.example.com'], type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  hosts!: string[];

  @ApiPropertyOptional({
    example: '/api',
    description: 'Optional PathPrefix (must start with /, e.g. /api). Empty omits PathPrefix.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  pathPrefix?: string | null;

  @ApiPropertyOptional({
    example: 8080,
    description: 'Override container port for this route; omit to use the app stack port.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number | null;

  @ApiPropertyOptional({
    description:
      'When true (default), use HTTPS entrypoint + ACME. When false, HTTP entrypoint only (no TLS resolver label).',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  https?: boolean;
}
