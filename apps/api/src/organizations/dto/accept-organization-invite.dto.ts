import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptOrganizationInviteDto {
  @ApiProperty({ example: 'token-from-email-link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
