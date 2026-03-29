import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { WebhookServiceAction, WebhookTargetMode } from '../entities/webhook.entity';

export class CreateWebhookDto {
  @ApiProperty({ example: 'CI redeploy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: ['service', 'notify_only'] })
  @IsEnum(['service', 'notify_only'] as const)
  targetMode!: WebhookTargetMode;

  @ApiPropertyOptional()
  @ValidateIf((o: CreateWebhookDto) => o.targetMode === 'service')
  @IsInt()
  @Min(1)
  serviceId?: number;

  @ApiPropertyOptional({ enum: ['redeploy', 'volume_backup', 'docker_command'] })
  @ValidateIf((o: CreateWebhookDto) => o.targetMode === 'service')
  @IsEnum(['redeploy', 'volume_backup', 'docker_command'] as const)
  serviceAction?: WebhookServiceAction;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateWebhookDto) =>
      o.targetMode === 'service' && o.serviceAction === 'volume_backup',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  volumeSource?: string;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateWebhookDto) =>
      o.targetMode === 'service' && o.serviceAction === 'docker_command',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  dockerCommand?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  notifyOnTrigger?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  notifyChannelId?: string;
}
