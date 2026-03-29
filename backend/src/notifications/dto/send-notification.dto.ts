import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendNotificationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  channelId!: string;

  @ApiProperty({ maxLength: 4096 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  message!: string;
}
