import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ format: 'uuid' })
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  token!: string;

  @ApiProperty({ example: 'Aa123456', minLength: 8, maxLength: 72 })
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/)
  newPassword!: string;
}
