import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty } from 'class-validator';

export class SetOrganizationMemberRoleDto {
  @ApiProperty({ example: 'colleague@company.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ enum: ['owner', 'member'] })
  @IsIn(['owner', 'member'])
  role!: 'owner' | 'member';
}
