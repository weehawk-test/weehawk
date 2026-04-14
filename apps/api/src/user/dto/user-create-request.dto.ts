import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { Role } from '../../auth/entities/role.enum';

export class UserCreateRequestDto {
  @ApiProperty({ example: 'adam', maxLength: 60, minLength: 2 })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({ example: 'mohamed', maxLength: 60 })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  lastName!: string;

  @ApiProperty({ example: 'admin@example.com', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Aa123456', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/, {
    message: 'Password must contain at least one uppercase, one lowercase, and one digit',
  })
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(Role , {message: 'Role must be a valid role'})
  role: Role = Role.USER;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean( {message: 'Enabled must be a boolean'})
  enabled = true;
}
