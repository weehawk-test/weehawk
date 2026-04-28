import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ApplicationVolumeRowDto {
  @ApiPropertyOptional({ example: 'app-data' })
  @IsString()
  source!: string;

  @ApiPropertyOptional({ example: '/data' })
  @IsString()
  target!: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

export class PatchApplicationVolumesDto {
  @ApiPropertyOptional({
    description: 'Volume mappings to persist in the generated application compose.',
    type: [ApplicationVolumeRowDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplicationVolumeRowDto)
  volumes?: ApplicationVolumeRowDto[];
}
