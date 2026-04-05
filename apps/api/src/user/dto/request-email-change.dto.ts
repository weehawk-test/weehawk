import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class RequestEmailChangeDto {
  @ApiProperty({ example: 'new@example.com', maxLength: 254 })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  newEmail!: string;
}
