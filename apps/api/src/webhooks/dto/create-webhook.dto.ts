import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      'Optional service identifier (publicId preferred; numeric id still accepted for legacy callers). Links webhook to a project service and is used for redeploy refresh/executor paths.',
  })
  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : String(value)))
  @IsString()
  @MaxLength(128)
  serviceId?: string;

  @ApiPropertyOptional({
    description: 'Deploy remote server id (required for bash webhooks).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  remoteServerId?: number;

  @ApiProperty({
    description:
      'Bash script deployed and run on the deploy host when the webhook fires.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  bashScript!: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Numeric notification channel id.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  notifyChannelId?: number;

  @ApiPropertyOptional({ example: 'Backup completed successfully.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notifyMessage?: string;

  @ApiPropertyOptional({
    description:
      'Public hostname only (e.g. example.com or hooks.example.com). Routed as-is behind Traefik.',
    example: 'example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  hooksPublicHost?: string;

  @ApiPropertyOptional({
    description:
      'If true, webhook is hidden from the main /webhooks list (e.g. auto redeploy from service settings).',
  })
  @IsOptional()
  @IsBoolean()
  hiddenFromWebhooksList?: boolean;

  @ApiProperty({
    description:
      'Organization workspace (required). Webhooks are scoped to the organization, not the user account.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  organizationPublicId!: string;
}
