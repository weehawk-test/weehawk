import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  Min,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateCronJobDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: '*/10 * * * *' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cronExpression?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Deploy remote server id.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  remoteServerId?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MaxLength(4000)
  notifyMessage?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Numeric notification channel id, or null to clear.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(1)
  @Type(() => Number)
  notifyChannelId?: number | null;

  @ApiPropertyOptional({ description: 'Bash script body.' })
  @IsOptional()
  @IsString()
  @MaxLength(400_000)
  bashScript?: string;
}
