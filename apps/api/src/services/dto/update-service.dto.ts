import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { CreateServiceDto } from './create-service.dto';

export class UpdateServiceDto extends PartialType(CreateServiceDto) {
  @ApiPropertyOptional({
    description:
      'IPv4 embedded in Magic traefik.me hostname (user-supplied). Omit or null to clear.',
    example: '127.0.0.1',
  })
  @IsOptional()
  @ValidateIf((_, value) => value != null && String(value).trim().length > 0)
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/, {
    message: 'magicTraefikMeIpv4 must be a dotted IPv4 address',
  })
  magicTraefikMeIpv4?: string | null;
}
