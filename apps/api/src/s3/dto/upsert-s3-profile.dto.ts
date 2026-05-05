import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertS3ProfileDto {
  @ApiPropertyOptional({
    description:
      'Stable profile id (`s3_…`). When set, this row is updated (allows changing `name`). Omit to create or upsert by `name` only.',
    example: 's3_ab12cd34',
  })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  publicId?: string;

  @ApiProperty({ example: 'prod-backups' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'https://s3.eu-west-1.amazonaws.com' })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({ example: 'eu-west-1' })
  @IsString()
  @IsNotEmpty()
  region: string;

  @ApiProperty({ example: 'my-backups-bucket' })
  @IsString()
  @IsNotEmpty()
  bucket: string;

  @ApiProperty({ example: 'AKIA...' })
  @IsString()
  @IsNotEmpty()
  accessKeyId: string;

  @ApiProperty({
    example: 'secret-value',
    required: false,
    description:
      'Required when creating a profile. When updating an existing profile, omit or leave empty to keep the stored secret.',
  })
  @IsOptional()
  @IsString()
  secretAccessKey?: string;

  @ApiProperty({
    required: false,
    deprecated: true,
    description:
      'Ignored. Path-style vs virtual-hosted is inferred from `endpoint` (same rules as AWS SDK for S3-compatible services).',
  })
  @IsBoolean()
  @IsOptional()
  forcePathStyle?: boolean;

  @ApiProperty({
    description:
      'Organization workspace (required). S3 profiles are scoped to the organization.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  organizationPublicId!: string;
}
