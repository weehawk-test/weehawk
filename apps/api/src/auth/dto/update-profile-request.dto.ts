import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileRequestDto {
  @ApiProperty({ example: 'ahmad', maxLength: 60 })
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({ example: 'mohamed', maxLength: 60 })
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  lastName!: string;
}
