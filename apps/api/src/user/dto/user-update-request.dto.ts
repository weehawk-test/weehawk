import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../auth/entities/role.enum';

export class UserUpdateRequestDto {
  @ApiPropertyOptional({ maxLength: 60, example: 'adam' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: 60, example: 'mohamed' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(Role, { message: 'Role must be a valid role' })
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Enabled must be a boolean' })
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Locked must be a boolean' })
  locked?: boolean;
}
