import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Platform' })
  @Transform(({ value }) =>
    String(value ?? '')
      .trim()
      .replace(/\s+/g, ' '),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}
