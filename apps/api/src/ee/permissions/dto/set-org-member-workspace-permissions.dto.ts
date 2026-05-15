import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsObject } from 'class-validator';

export class SetOrgMemberWorkspacePermissionsDto {
  @ApiProperty({ example: 'member@company.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description:
      'Permission flags: `false` blocks an area for this member; `true` removes a block (full access is the default). Owners ignore stored permissions.',
    example: { cron_jobs: false, webhooks: true },
  })
  @IsObject()
  permissions!: Record<string, unknown>;
}
