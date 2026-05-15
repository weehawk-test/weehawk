import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateInstanceEnterpriseLicenseDto {
  @ApiProperty({
    description:
      'Vendor-signed enterprise license token (whl1...). Send an empty string to remove the stored key.',
    example: '',
  })
  @IsString()
  licenseKey!: string;
}
