import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
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

const DOMAINS_JSON_MAX = 65_535;

export class CreateRemoteServerDto {
  @ApiProperty({ example: 'Production Docker' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '203.0.113.10' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host!: string;

  @ApiProperty({ example: 22, required: false, default: 22 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiProperty({ example: 'deploy' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sshUser!: string;

  @ApiProperty({
    required: false,
    enum: ['deploy', 'build'],
    default: 'deploy',
    description:
      'deploy = run containers on this host; build = dedicated host for image builds (Swarm applications can use a separate build host).',
  })
  @IsOptional()
  @IsIn(['deploy', 'build'])
  serverRole?: 'deploy' | 'build';

  @ApiProperty({
    description:
      'OpenSSH private key (PEM). Stored encrypted in the database. Requires WEEHAWK_ENCRYPTION_KEY.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(64)
  @MaxLength(32_000)
  privateKey!: string;

  @ApiProperty({
    required: false,
    description:
      'Public IPv4 for Magic Traefik.me default hostnames on services deployed to this host.',
    example: '203.0.113.10',
  })
  @IsOptional()
  @ValidateIf(
    (_object, value) => value != null && String(value).trim().length > 0,
  )
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/, {
    message: 'publicIpv4 must be a dotted IPv4 address',
  })
  publicIpv4?: string;

  @ApiProperty({
    required: false,
    description:
      'Optional JSON string listing domains or metadata for this server (shown on the Domains page for deploy hosts).',
    example: '["app.example.com","api.example.com"]',
  })
  @IsOptional()
  @IsString()
  @MaxLength(DOMAINS_JSON_MAX)
  domainsJson?: string;
}
