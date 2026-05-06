import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class TestRegistryAccountDto {
  @ApiProperty({
    description: 'Remote server reference (publicId or legacy numeric id).',
    example: 'rsv_abc123',
  })
  @IsString()
  @MinLength(1)
  remoteServerRef!: string;
}
