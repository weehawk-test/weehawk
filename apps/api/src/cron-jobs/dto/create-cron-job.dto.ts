import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCronJobDto {
  @ApiProperty({ example: 'Nightly task' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '0 * * * *' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  cronExpression!: string;

  @ApiProperty({ description: 'Deploy remote server id (SSH + crontab).' })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  remoteServerId!: number;

  @ApiProperty({ description: 'Bash script to run on the deploy host.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400_000)
  bashScript!: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Numeric notification channel id.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  notifyChannelId?: number;

  @ApiPropertyOptional({ example: 'Scheduled job finished.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notifyMessage?: string;

  @ApiProperty({
    description:
      'Organization workspace (required). Cron jobs are scoped to the organization.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  organizationPublicId!: string;
}
