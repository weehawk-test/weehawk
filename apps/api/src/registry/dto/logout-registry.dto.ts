import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LogoutRegistryDto {
  @ApiProperty({ example: 'docker.io' })
  @IsString()
  @IsNotEmpty()
  providerUrl: string;
}
