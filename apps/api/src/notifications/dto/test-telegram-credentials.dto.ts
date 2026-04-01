import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TestTelegramCredentialsDto {
  @ApiProperty({ example: '123456789:AA...' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(512)
  botToken!: string;

  @ApiProperty({ example: '-1001234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  chatId!: string;

  @ApiPropertyOptional({ example: 'Production Alerts' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  channelName?: string;
}
