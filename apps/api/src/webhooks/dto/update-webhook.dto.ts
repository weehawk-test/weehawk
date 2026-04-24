import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  Min,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateWebhookDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MaxLength(4000)
  notifyMessage?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Numeric notification channel id, or null to clear.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsInt()
  @Min(1)
  @Type(() => Number)
  notifyChannelId?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Deploy remote server id for bash webhooks.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  remoteServerId?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Bash script on the deploy host.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  bashScript?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Public hostname (e.g. example.com or hooks.example.com); null clears public host (IP:port URL).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MaxLength(255)
  hooksPublicHost?: string | null;
}
