import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PatchApplicationImageDeployDto {
  @ApiProperty({
    description: 'Docker image reference (e.g. nginx:1.27, registry.io/org/app:v1)',
    example: 'nginx:1.27-alpine',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  imageRef!: string;

  @ApiPropertyOptional({ example: 8080, default: 3000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  containerPort?: number;

  @ApiPropertyOptional({ example: 80 })
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

  @ApiPropertyOptional({
    description: 'JSON array of { key, value, store } for env / Docker secrets',
  })
  @IsOptional()
  @IsString()
  variablesJson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  networksJson?: string;

  @ApiPropertyOptional({ description: 'Pipe-separated external network names' })
  @IsOptional()
  @IsString()
  externalNetworks?: string;

  @ApiPropertyOptional({ description: 'Pipe-separated stack overlay keys' })
  @IsOptional()
  @IsString()
  stackNetworks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  volumesJson?: string;
}
