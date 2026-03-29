import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateNotificationChannelDto {
  @ApiProperty({ example: 'Production Alerts', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: '123456789:AA...' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(512)
  botToken!: string;

  @ApiProperty({ example: '-1001234567890 or @channelusername' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  chatId!: string;
}
