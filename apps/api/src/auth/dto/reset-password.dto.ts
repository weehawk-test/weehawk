import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'token-from-email-link' })
  @IsNotEmpty( {message: 'Token is required'})
  token!: string;

  @ApiProperty({ example: 'Aa123456', minLength: 8, maxLength: 72 })
  @IsNotEmpty( {message: 'Password is required'})
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must be less than 72 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  })
  newPassword!: string;
}
