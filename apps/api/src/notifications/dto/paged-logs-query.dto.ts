import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PagedLogsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '1'), 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '20'), 10))
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 20;

  @ApiPropertyOptional({ description: 'Search in channel name and type' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiProperty({
    description:
      'Organization workspace (required). Channels are listed for this org only.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  organizationPublicId!: string;
}
