import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChangeEmailRequestDto {
  @ApiProperty({ example: 'newemail@example.com', maxLength: 254 })
  @IsNotEmpty()
  @IsEmail()
  @IsString()
  @MaxLength(254)
  newEmail!: string;
}
