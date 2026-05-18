import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/** Partial update of generated Postgres stack YAML (credentials unchanged). */
export class PostgresStackUpdateDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Host port 1–65535 mapped to container 5432, or null to remove publishing',
    example: 5432,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  @Max(65535)
  publishPort?: number | null;

  @ApiPropertyOptional({
    example: 2,
    description: 'Swarm service replicas (1–10)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  replicas?: number;

  @ApiPropertyOptional({
    description:
      'When true, attach the database stack to the shared Traefik `weehawk` overlay network',
  })
  @IsOptional()
  @IsBoolean()
  attachToWeehawkNetwork?: boolean;
}
