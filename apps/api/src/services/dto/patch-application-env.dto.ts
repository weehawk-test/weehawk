import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ApplicationEnvRowDto {
  @ApiPropertyOptional({ example: 'DATABASE_URL' })
  @IsString()
  key!: string;

  @ApiPropertyOptional({ example: 'postgres://user:pass@db:5432/app' })
  @IsString()
  value!: string;
}

export class PatchApplicationEnvDto {
  @ApiPropertyOptional({
    description: 'Environment key-value rows for application services.',
    type: [ApplicationEnvRowDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplicationEnvRowDto)
  variables?: ApplicationEnvRowDto[];
}
