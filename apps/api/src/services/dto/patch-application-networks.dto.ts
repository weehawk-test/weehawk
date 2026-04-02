import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class PatchApplicationNetworksDto {
  @ApiPropertyOptional({
    description:
      'Full Docker network names to attach (e.g. other stacks’ overlay networks)',
    type: [String],
    example: ['mydb_abc_network'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  external?: string[];

  @ApiPropertyOptional({
    description: 'Compose network keys to create in this stack (overlay)',
    type: [String],
    example: ['app-network', 'cache-net'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stack?: string[];
}
