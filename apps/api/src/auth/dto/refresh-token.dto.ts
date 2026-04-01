import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'uuid-refresh-token-here' })
  @IsNotEmpty()
  @IsString()
  refreshToken!: string;
}
