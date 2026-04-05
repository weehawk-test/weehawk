import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRegistryAccountDto {
  @ApiProperty({ example: 'GitHub GHCR' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'ghcr.io' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  providerUrl!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  username!: string;

  @ApiProperty({ description: 'Password or personal access token' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  password!: string;
}
