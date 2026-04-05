import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com', maxLength: 254 })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
