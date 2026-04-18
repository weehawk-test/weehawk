import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { UpsertS3ProfileDto } from './upsert-s3-profile.dto';

export class TestS3ConnectionDto extends UpsertS3ProfileDto {
  @ApiProperty({
    description:
      'Deploy server that runs the check (HTTP GET to a short-lived presigned list URL via curl on the host).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  remoteServerId: number;
}
