import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteS3ProfileDto {
  @ApiProperty({ example: 'prod-backups' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
