import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ConfirmTokenDto {
  @ApiProperty({ format: 'uuid' })
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  token!: string;
}
