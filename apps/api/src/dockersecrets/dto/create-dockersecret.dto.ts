import { ApiProperty } from '@nestjs/swagger';

export class CreateDockersecretDto {
  @ApiProperty({ description: 'Remote server (SSH deploy host) id', example: 1 })
  remoteServerId: number;

  @ApiProperty({ example: 'DB_PASSWORD' })
  name: string;

  @ApiProperty({ example: 'super_secret_123' })
  value: string;
}

export class BulkImportDto {
  @ApiProperty({ description: 'Remote server (SSH deploy host) id', example: 1 })
  remoteServerId: number;

  @ApiProperty({ example: 'KEY1=VAL1\nKEY2=VAL2' })
  envText: string;
}
