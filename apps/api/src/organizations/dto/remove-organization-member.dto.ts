import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class RemoveOrganizationMemberDto {
  @ApiProperty({ example: 'teammate@company.com' })
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}
