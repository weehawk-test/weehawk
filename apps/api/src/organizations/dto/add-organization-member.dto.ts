import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AddOrganizationMemberDto {
  @ApiProperty({ example: 'teammate@company.com' })
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @ApiProperty({
    required: false,
    description:
      'Optional notification channel id/publicId. In self-hosted mode, sends join details (including temporary credentials for newly created users).',
    example: 'nch_abc123def456',
  })
  @IsOptional()
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  notificationChannelId?: string;

  @ApiProperty({
    required: false,
    description:
      'Optional deploy remote server id override for invite notification delivery.',
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || String(value).trim() === ''
      ? undefined
      : Number(value),
  )
  @IsInt()
  @Min(1)
  notificationRemoteServerId?: number;
}
