import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class RollMagicTraefikMeDto {
  @ApiPropertyOptional({
    description:
      'IPv4 for the traefik.me hostname. Saved on the service; required on roll if not already stored.',
    example: '203.0.113.10',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/, {
    message: 'publicIpv4 must be a dotted IPv4 address',
  })
  publicIpv4?: string;
}
