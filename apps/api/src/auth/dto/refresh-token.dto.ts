import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    example: 'uuid-refresh-token-here',
    description:
      'Optional when refresh token is sent as HttpOnly cookie (browser clients).',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
