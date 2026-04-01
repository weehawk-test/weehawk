import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginRegistryDto {
  @ApiProperty({ example: 'docker.io' })
  @IsString()
  @IsNotEmpty()
  providerUrl: string;

  @ApiProperty({ example: 'my-username' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'my-password-or-token' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
