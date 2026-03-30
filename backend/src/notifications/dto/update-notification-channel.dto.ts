import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { CreateNotificationChannelDto } from './create-notification-channel.dto';

export class UpdateNotificationChannelDto extends PartialType(
  CreateNotificationChannelDto,
) {
  @ApiPropertyOptional({
    description: 'Channel-specific configuration payload',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
