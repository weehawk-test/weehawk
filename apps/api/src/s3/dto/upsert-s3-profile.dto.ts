import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertS3ProfileDto {
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

  @ApiProperty({ example: 'secret-value' })
  @IsString()
  @IsNotEmpty()
  secretAccessKey: string;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  forcePathStyle?: boolean;
}
