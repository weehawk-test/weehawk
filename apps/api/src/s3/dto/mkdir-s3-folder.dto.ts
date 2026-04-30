import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MkdirS3FolderDto {
  @ApiProperty({
    description:
      'Full object key for the folder marker (usually ends with `/`).',
    example: 'backups/2025/',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  key!: string;
}
