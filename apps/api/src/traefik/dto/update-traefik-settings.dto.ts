import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class UpdateTraefikSettingsDto {
  @ApiPropertyOptional({ example: 'ops@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  acmeEmail?: string;

  @ApiPropertyOptional({
    example: 'weehawk.example.com',
    description:
      'Hostname for Weehawk UI (HTTPS → host port 3000). Empty string clears.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  @Matches(/^(|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)$/, {
    message: 'platformDomain must be a valid hostname',
  })
  platformDomain?: string;

  @ApiPropertyOptional({
    example: '/var/www/weehawk/traefik/data/acme.json',
    description: 'Host file mounted at /acme.json inside Traefik',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  @Matches(/^[^\0]+$/, { message: 'Invalid path' })
  acmeStorageHostPath?: string;

  @ApiPropertyOptional({ example: 'traefik:v2.11' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  traefikImage?: string;

  @ApiPropertyOptional({ example: 'letsencrypt' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message:
      'certResolverName must be alphanumeric (underscore/hyphen allowed)',
  })
  certResolverName?: string;

  @ApiPropertyOptional({ example: 'web' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  httpEntrypoint?: string;

  @ApiPropertyOptional({ example: 'websecure' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  httpsEntrypoint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  redirectHttpToHttps?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dashboardEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  swarmMode?: boolean;

  @ApiPropertyOptional({
    description:
      'Full static Traefik YAML; when set, overrides auto-generated static file preview. Send empty string to clear.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  staticConfigOverride?: string;
}
