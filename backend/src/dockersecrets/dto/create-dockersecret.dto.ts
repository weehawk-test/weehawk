import { ApiProperty } from '@nestjs/swagger';

export class CreateDockersecretDto { 
  @ApiProperty({ example: 'DB_PASSWORD' })
  name: string;

  @ApiProperty({ example: 'super_secret_123' })
  value: string;
}

export class BulkImportDto {
  @ApiProperty({ example: 'KEY1=VAL1\nKEY2=VAL2' })
  envText: string;
}