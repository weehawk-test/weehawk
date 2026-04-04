import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
    description: 'Optional extra SSH client options (space-separated).',
  })
  @IsOptional()
  @IsString()
  extraSshOptions?: string;
}
